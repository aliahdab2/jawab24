/**
 * One-off repair: re-scope inbox rows whose denormalized `workspace_id` drifted
 * away from their page's current `workspace_id`.
 *
 * Cause: until the fix in services/pages.ts, `syncFromFacebook`'s reclaim branch
 * moved a disconnected page into the claiming workspace but never updated the
 * denormalized copies of `workspace_id` on comments / instagram_comments /
 * messages. The page changed hands; its inbox stayed behind — visible to the
 * PREVIOUS owner's workspace-scoped queries and invisible to the new owner.
 *
 * Detected in production 2026-07-25: 145 messages on page "اخبار العالم مع ابو
 * ربيع" still pointed at the workspace it was reclaimed from in May.
 *
 * The page row is the source of truth — this script only ever moves child rows
 * TO their page's current workspace. It never touches a page row, and never
 * touches ai_usage_log / logs / usage (cost + audit attribution stays with
 * whoever incurred it).
 *
 * Defaults to DRY-RUN. Pass --apply to actually write.
 *
 *   # Dry-run (safe, no writes):
 *   docker exec jawab24-backend-green npx tsx src/scripts/backfill-page-workspace-drift.ts
 *
 *   # Apply for real:
 *   docker exec jawab24-backend-green npx tsx src/scripts/backfill-page-workspace-drift.ts --apply
 *
 *   # Single page (verify one before the sweep):
 *   docker exec jawab24-backend-green npx tsx src/scripts/backfill-page-workspace-drift.ts --apply --page <page-id>
 *
 * Idempotent: once a page is repaired it drops out of the drift query, so
 * re-running is a no-op. Safe to re-run after a partial failure.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { rescopePageWorkspace } from '../services/pages';

interface Args {
    apply: boolean;
    targetPageId: string | null;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const apply = argv.includes('--apply');
    const pageIdx = argv.indexOf('--page');
    const targetPageId = pageIdx >= 0 && argv[pageIdx + 1] ? argv[pageIdx + 1] : null;
    return { apply, targetPageId };
}

interface DriftedPage {
    pageId: string;
    pageName: string | null;
    workspaceId: string;
    driftedComments: number;
    driftedIgComments: number;
    driftedMessages: number;
}

/**
 * Find every page with at least one child row whose workspace_id disagrees with
 * the page's. Counts come from the same joins the repair uses, so the numbers
 * printed in a dry-run are exactly what --apply will move.
 */
async function findDrift(targetPageId: string | null): Promise<DriftedPage[]> {
    const pageFilter = targetPageId ? sql`AND p.id = ${targetPageId}::uuid` : sql``;

    // db.execute resolves to the row array itself in this Drizzle setup
    // (see services/analytics.ts) — there is no `.rows` wrapper.
    const rows = await db.execute(sql`
        SELECT p.id                       AS page_id,
               p.name                     AS page_name,
               p.workspace_id             AS workspace_id,
               COALESCE(c.n, 0)::int      AS drifted_comments,
               COALESCE(ig.n, 0)::int     AS drifted_ig_comments,
               COALESCE(m.n, 0)::int      AS drifted_messages
        FROM pages p
        LEFT JOIN (
            SELECT po.page_id, COUNT(*) AS n
            FROM comments cm
            JOIN posts po ON po.id = cm.post_id
            JOIN pages pg ON pg.id = po.page_id
            WHERE cm.workspace_id IS DISTINCT FROM pg.workspace_id
            GROUP BY po.page_id
        ) c ON c.page_id = p.id
        LEFT JOIN (
            SELECT im.page_id, COUNT(*) AS n
            FROM instagram_comments igc
            JOIN instagram_media im ON im.id = igc.media_id
            JOIN pages pg ON pg.id = im.page_id
            WHERE igc.workspace_id IS DISTINCT FROM pg.workspace_id
            GROUP BY im.page_id
        ) ig ON ig.page_id = p.id
        LEFT JOIN (
            SELECT ms.page_id, COUNT(*) AS n
            FROM messages ms
            JOIN pages pg ON pg.id = ms.page_id
            WHERE ms.workspace_id IS DISTINCT FROM pg.workspace_id
            GROUP BY ms.page_id
        ) m ON m.page_id = p.id
        WHERE p.workspace_id IS NOT NULL
          AND (c.n > 0 OR ig.n > 0 OR m.n > 0)
          ${pageFilter}
        ORDER BY (COALESCE(c.n, 0) + COALESCE(ig.n, 0) + COALESCE(m.n, 0)) DESC
    `);

    return (rows as Record<string, unknown>[]).map(r => ({
        pageId: r.page_id as string,
        pageName: r.page_name as string | null,
        workspaceId: r.workspace_id as string,
        driftedComments: r.drifted_comments as number,
        driftedIgComments: r.drifted_ig_comments as number,
        driftedMessages: r.drifted_messages as number,
    }));
}

async function main() {
    const args = parseArgs();

    console.warn(`[drift] Scanning for pages whose inbox rows point at the wrong workspace${args.targetPageId ? ` (page ${args.targetPageId})` : ''}...`);
    const drifted = await findDrift(args.targetPageId);

    if (drifted.length === 0) {
        console.warn('[drift] No drift found — nothing to repair.');
        return;
    }

    let totalComments = 0;
    let totalIgComments = 0;
    let totalMessages = 0;

    for (const page of drifted) {
        const label = `${page.pageName ?? page.pageId} → ws ${page.workspaceId}`;
        process.stdout.write(
            `[drift] ${label}: ${page.driftedComments} comment(s), ` +
            `${page.driftedIgComments} IG comment(s), ${page.driftedMessages} message(s) ... `
        );

        if (args.apply) {
            // Reuses the exact helper the reclaim path now calls, so the repair
            // and the fix can never diverge.
            const moved = await rescopePageWorkspace(page.pageId, page.workspaceId);
            totalComments += moved.comments;
            totalIgComments += moved.instagramComments;
            totalMessages += moved.messages;
            process.stdout.write('repaired\n');
        } else {
            totalComments += page.driftedComments;
            totalIgComments += page.driftedIgComments;
            totalMessages += page.driftedMessages;
            process.stdout.write('would repair\n');
        }
    }

    const verb = args.apply ? 'Moved' : 'Would move';
    console.warn('\n[drift] Summary:');
    console.warn(`  Pages affected:  ${drifted.length}`);
    console.warn(`  ${verb}:          ${totalComments} comment(s), ${totalIgComments} IG comment(s), ${totalMessages} message(s)`);

    if (args.apply) {
        // Re-scan: the drift query is the acceptance test for its own repair.
        const remaining = await findDrift(args.targetPageId);
        if (remaining.length === 0) {
            console.warn('  Verification:    clean — no drift remains.');
        } else {
            console.error(`  Verification:    FAILED — ${remaining.length} page(s) still drifted. Investigate before re-running.`);
            process.exitCode = 1;
        }
    } else {
        console.warn('\n[drift] DRY-RUN complete. Re-run with --apply to repair.');
    }
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch(err => {
        console.error('[drift] Fatal error:', err);
        process.exit(1);
    });
