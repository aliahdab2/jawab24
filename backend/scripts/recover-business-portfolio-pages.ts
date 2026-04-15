/**
 * One-time recovery: sync pages for users affected by the Business Portfolio bug.
 *
 * Before the granular_scopes fallback shipped, users whose Facebook Pages were owned
 * by a Meta Business Portfolio had /me/accounts return empty even with full access.
 * Those users ended up with a stored Facebook token but zero page records in DB.
 *
 * This script finds those users and re-runs syncFromFacebook — with the new fallback
 * logic, their pages will now be discovered via /debug_token granular_scopes.
 *
 * Usage:
 *   Local:      npx tsx backend/scripts/recover-business-portfolio-pages.ts
 *   Production: docker exec jawab24-backend-green node backend/dist/scripts/recover-business-portfolio-pages.js
 *
 * Safe to re-run — syncFromFacebook uses existingPagesMap for idempotency.
 */
import { db } from '../src/db';
import { users, workspaces, workspaceMembers, pages } from '../src/db/schema';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { pagesService } from '../src/services/pages';
import { maybeDecryptToken } from '../src/services/facebookCrypto';

interface AffectedRow {
    userId: string;
    userName: string | null;
    userEmail: string | null;
    facebookId: string | null;
    facebookAccessToken: string;
    workspaceId: string;
}

const simpleLogger = {
    info: (msg: string, data?: Record<string, unknown>) => console.log(`[info] ${msg}`, data ? JSON.stringify(data) : ''),
    warn: (msg: string, data?: Record<string, unknown>) => console.log(`[warn] ${msg}`, data ? JSON.stringify(data) : ''),
    error: (msg: string, data?: Record<string, unknown>) => console.error(`[error] ${msg}`, data ? JSON.stringify(data) : ''),
    debug: (msg: string, data?: Record<string, unknown>) => console.log(`[debug] ${msg}`, data ? JSON.stringify(data) : ''),
};

async function main() {
    console.log('=== Business Portfolio Page Recovery ===');
    console.log(`Time: ${new Date().toISOString()}\n`);

    // Find users with a non-empty Facebook token who own a workspace that has zero pages.
    const rows: AffectedRow[] = await db
        .select({
            userId: users.id,
            userName: users.name,
            userEmail: users.email,
            facebookId: users.facebookId,
            facebookAccessToken: users.facebookAccessToken,
            workspaceId: workspaces.id,
        })
        .from(users)
        .innerJoin(workspaceMembers, and(
            eq(workspaceMembers.userId, users.id),
            eq(workspaceMembers.role, 'owner'),
        ))
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(and(
            isNotNull(users.facebookAccessToken),
            ne(users.facebookAccessToken, ''),
            sql`NOT EXISTS (SELECT 1 FROM ${pages} WHERE ${pages.workspaceId} = ${workspaces.id})`,
        )) as AffectedRow[];

    console.log(`Found ${rows.length} user(s) with a Facebook token but zero pages.\n`);

    if (rows.length === 0) {
        console.log('Nothing to recover. Exiting.');
        return;
    }

    let recovered = 0;
    let stillEmpty = 0;
    let failed = 0;

    for (const row of rows) {
        const label = `${row.userName ?? '(no name)'} <${row.userEmail ?? '?'}> fb_id=${row.facebookId ?? '?'}`;
        console.log(`--- ${label} ---`);

        let token: string;
        try {
            token = maybeDecryptToken(row.facebookAccessToken);
        } catch (err) {
            console.error(`  DECRYPT FAILED: ${err instanceof Error ? err.message : err}`);
            failed++;
            continue;
        }

        try {
            const result = await pagesService.syncFromFacebook(
                row.workspaceId,
                row.userId,
                token,
                undefined,
                simpleLogger,
            );

            const synced = result.syncedPages?.length ?? 0;
            if (synced > 0) {
                console.log(`  RECOVERED: ${synced} page(s) synced.`);
                recovered++;
            } else {
                console.log('  STILL EMPTY: sync returned 0 pages (user really has no authorized pages).');
                stillEmpty++;
            }
        } catch (err) {
            console.error(`  SYNC FAILED: ${err instanceof Error ? err.message : err}`);
            failed++;
        }

        console.log('');
    }

    console.log('=== Summary ===');
    console.log(`Recovered:   ${recovered}`);
    console.log(`Still empty: ${stillEmpty} (user genuinely has no pages)`);
    console.log(`Failed:      ${failed}`);
    console.log(`Total:       ${rows.length}`);
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Recovery script failed:', err);
        process.exit(1);
    });
