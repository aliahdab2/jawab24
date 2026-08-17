// One-shot ops script: re-subscribe every connected Facebook page to webhooks so the
// `messaging_postbacks` field is added. Meta does NOT retroactively send postbacks to pages
// that were subscribed before we added the field, so the Post Reply «Read more» button is
// inert on existing pages until this runs. Idempotent — re-subscribing is safe.
//
// Run (prod): compile + `node dist/scripts/resubscribe-messaging-postbacks.js`, or via the
// same prod-script mechanism used for other backfills. Reads/decrypts tokens locally; only
// outbound calls are the Graph API subscribe requests.

import { db } from '../db';
import { pages } from '../db/schema';
import { and, isNotNull, ne } from 'drizzle-orm';
import { safeDecryptToken } from '../services/facebookCrypto';
import { facebookService } from '../services/facebook';
import { installGraphRetryConsoleObserver } from '../lib/graphRetryMetrics';

// Standalone entrypoint — index.ts's observer bootstrap never runs here, so wire the
// console-backed one or every Graph retry decision below is silent and uncounted.
installGraphRetryConsoleObserver();

type Stat = { ok: number; failed: number; skipped: number };

async function main(): Promise<Stat> {
    const stat: Stat = { ok: 0, failed: 0, skipped: 0 };
    // Connected FB pages only: a Facebook page id present and a non-empty (non-revoked) token.
    const rows = await db
        .select({ id: pages.id, name: pages.name, facebookPageId: pages.facebookPageId, accessToken: pages.accessToken })
        .from(pages)
        .where(and(isNotNull(pages.facebookPageId), ne(pages.accessToken, '')));

    process.stdout.write(`[resubscribe] ${rows.length} connected FB page(s)\n`);

    for (const row of rows) {
        const fbPageId = row.facebookPageId;
        if (!fbPageId) { stat.skipped++; continue; }
        const token = safeDecryptToken(row.accessToken, { entity: 'page', id: row.id });
        if (!token) {
            stat.skipped++;
            process.stdout.write(`[resubscribe] ${row.name ?? row.id}: no token — skip\n`);
            continue;
        }
        const ok = await facebookService.subscribePageToWebhooks(fbPageId, token);
        if (ok) {
            stat.ok++;
            process.stdout.write(`[resubscribe] ${row.name ?? row.id}: OK\n`);
        } else {
            stat.failed++;
            process.stdout.write(`[resubscribe] ${row.name ?? row.id}: FAILED\n`);
        }
    }
    return stat;
}

main()
    .then(stat => {
        process.stdout.write(`\n[resubscribe] DONE: ok=${stat.ok} failed=${stat.failed} skipped=${stat.skipped}\n`);
        process.exit(stat.failed === 0 ? 0 : 1);
    })
    .catch(err => {
        process.stderr.write(`[resubscribe] FATAL: ${err}\n`);
        process.exit(1);
    });
