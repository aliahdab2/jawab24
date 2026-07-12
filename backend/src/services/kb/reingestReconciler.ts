import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { config } from '../../config';
import { pagesService } from '../pages';

export interface ReingestSweepResult {
    /** drifted pages found this sweep (== batch processed) */
    scanned: number;
    /** drifted pages successfully re-ingested + re-activated */
    reingested: number;
    /** drifted pages whose re-ingest ultimately failed (reported to Sentry by reingestPage) */
    failed: number;
}

/**
 * Self-heal pages whose stored vector chunks drifted from their saved KB text.
 *
 * A KB edit (updatePage/addFact/sync/ecommerce) bumps `kb_version` then re-ingests
 * FIRE-AND-FORGET; if that async ingest fails or lags, `kb_active_version` never catches up and
 * retrieval keeps serving the OLD version's chunks (or none, if never activated). This sweep finds
 * those pages (`kb_active_version` behind `kb_version`, or null) and re-ingests their CURRENT KB,
 * which transactionally rebuilds + activates the right version. Idempotent; in-sync pages are skipped.
 *
 * Batched + oldest-drift-first so a sweep can't spike embedding cost; most sweeps find 0 (zero cost).
 * `reingest` is injectable for tests.
 */
export async function reingestDriftedPages(opts: {
    batchSize?: number;
    reingest?: (pageId: string) => Promise<boolean>;
} = {}): Promise<ReingestSweepResult> {
    const batchSize = opts.batchSize ?? config.kbReingest.batchSize;
    const reingest = opts.reingest ?? ((pageId: string) => pagesService.reingestPage(pageId));

    // Drift = active version fell BEHIND the current version (a fire-and-forget ingest didn't
    // complete) or was never activated (null). NOT `active > version` — that's a seed/manual
    // artifact, not stale KB, and re-ingesting it would only churn. Also require content worth
    // ingesting (KB text or a linked store) so a re-ingest actually produces chunks and clears the
    // drift — never re-select content-less pages forever.
    const result = await db.execute(sql`
        SELECT id FROM pages
        WHERE (kb_active_version IS NULL OR kb_active_version < COALESCE(kb_version, 0))
          AND (
            (knowledge_base IS NOT NULL AND btrim(knowledge_base) <> '')
            OR ecommerce_store_id IS NOT NULL
          )
        ORDER BY kb_updated_at ASC NULLS FIRST
        LIMIT ${sql.raw(String(Math.max(1, batchSize)))}
    `);
    const ids: string[] = ((result as unknown as { rows?: Array<{ id: string }> }).rows
        ?? (result as unknown as Array<{ id: string }>)).map(r => r.id);

    let reingested = 0;
    let failed = 0;
    for (const id of ids) {
        // Serial: one re-ingest at a time keeps embedding rate modest and isolates failures.
        const ok = await reingest(id);
        if (ok) reingested++; else failed++;
    }

    return { scanned: ids.length, reingested, failed };
}
