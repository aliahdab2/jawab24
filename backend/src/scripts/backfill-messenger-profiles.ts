// One-shot ops script: apply the Messenger Profile (greeting + ice breakers) to every
// connected, auto-reply-enabled Facebook page. New connects get this automatically in
// syncFromFacebook; existing pages need this backfill once.
//
// DRY-RUN BY DEFAULT — prints what would be synced. Pass --apply to actually call the
// Graph API. Paced (one page per PACING_MS) to stay far from app-level rate limits.
//
// Per page: a stored config is synced as-is (a stored DISABLED config is skipped —
// never resurrect fields a merchant turned off); a page with no stored config gets the
// generic فصحى default seeded and synced.
//
// Run (prod): compile + `node dist/scripts/backfill-messenger-profiles.js [--apply]`.
// Reads/decrypts tokens locally; only outbound calls are the Graph API profile requests.

import { db } from '../db';
import { pages } from '../db/schema';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { safeDecryptToken } from '../services/facebookCrypto';
import {
    buildDefaultMessengerProfileConfig,
    setupMessengerProfile,
} from '../services/messengerProfile';

const PACING_MS = 500;
const apply = process.argv.includes('--apply');

type Stat = { synced: number; wouldSync: number; failed: number; skipped: number };

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<Stat> {
    const stat: Stat = { synced: 0, wouldSync: 0, failed: 0, skipped: 0 };

    // Connected FB pages with auto-reply on: a Facebook page id present and a
    // non-empty (non-revoked) token. Auto-reply-off pages are skipped — an ice
    // breaker that produces silence is worse than an empty welcome screen.
    const rows = await db
        .select({
            id: pages.id,
            name: pages.name,
            facebookPageId: pages.facebookPageId,
            accessToken: pages.accessToken,
            messengerProfile: pages.messengerProfile,
        })
        .from(pages)
        .where(and(
            isNotNull(pages.facebookPageId),
            ne(pages.accessToken, ''),
            eq(pages.autoReplyEnabled, true),
        ));

    process.stdout.write(`[messenger-profile] ${rows.length} connected FB page(s) with auto-reply on${apply ? '' : ' (DRY RUN — pass --apply to sync)'}\n`);

    for (const row of rows) {
        const label = row.name ?? row.id;
        if (!row.facebookPageId) { stat.skipped++; continue; }

        const stored = row.messengerProfile;
        if (stored?.config && !stored.config.enabled) {
            stat.skipped++;
            process.stdout.write(`[messenger-profile] ${label}: merchant disabled — skip\n`);
            continue;
        }

        const token = safeDecryptToken(row.accessToken, { entity: 'page', id: row.id });
        if (!token) {
            stat.skipped++;
            process.stdout.write(`[messenger-profile] ${label}: no token — skip\n`);
            continue;
        }

        const config = stored?.config ?? buildDefaultMessengerProfileConfig(row.name);
        const source = stored?.config ? 'stored config' : 'default config';

        if (!apply) {
            stat.wouldSync++;
            process.stdout.write(`[messenger-profile] ${label}: would sync ${source} (greeting ar=${!!config.greeting.ar} en=${!!config.greeting.en}, ${config.iceBreakers.length} ice breaker(s))\n`);
            continue;
        }

        try {
            await setupMessengerProfile(
                { id: row.id, facebookPageId: row.facebookPageId, name: row.name, messengerProfile: stored },
                token,
                config,
            );
            stat.synced++;
            process.stdout.write(`[messenger-profile] ${label}: OK (${source})\n`);
        } catch (err) {
            stat.failed++;
            const message = err instanceof Error ? err.message : String(err);
            process.stdout.write(`[messenger-profile] ${label}: FAILED — ${message}\n`);
        }
        await sleep(PACING_MS);
    }
    return stat;
}

main()
    .then(stat => {
        process.stdout.write(`\n[messenger-profile] DONE: synced=${stat.synced} wouldSync=${stat.wouldSync} failed=${stat.failed} skipped=${stat.skipped}\n`);
        process.exit(stat.failed === 0 ? 0 : 1);
    })
    .catch(err => {
        process.stderr.write(`[messenger-profile] FATAL: ${err}\n`);
        process.exit(1);
    });
