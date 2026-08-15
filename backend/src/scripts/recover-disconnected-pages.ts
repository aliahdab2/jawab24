/**
 * One-off recovery: re-establish page access tokens for users whose pages were
 * incorrectly disconnected by the bulk-clear bug in tokenRefresh.ts (fixed in
 * commit ea1b94d8 / branch fix/token-refresh-bulk-clear-bug).
 *
 * For each affected user:
 *   1. Find users where ALL their pages have empty access_token (signature of
 *      the bulk-clear bug — partial disconnects are likely real revocations
 *      and are skipped).
 *   2. Decrypt their stored long-lived user-level facebook_access_token.
 *   3. Call FB /me/accounts to fetch fresh page tokens.
 *   4. If FB accepts the user token: write the fresh page tokens back to DB
 *      and the merchant's pages start replying again on the next webhook.
 *   5. If FB rejects the user token: the user genuinely needs to manually
 *      reconnect — log it and move on.
 *
 * Defaults to DRY-RUN. Pass --apply to actually write tokens.
 *
 * Run from inside the backend container so it has DB + FB encryption key
 * + FB app credentials in env:
 *
 *   # Dry-run (safe, no writes):
 *   docker exec jawab24-backend-green npx tsx src/scripts/recover-disconnected-pages.ts
 *
 *   # Apply for real:
 *   docker exec jawab24-backend-green npx tsx src/scripts/recover-disconnected-pages.ts --apply
 *
 *   # Target a single user (testing one merchant first):
 *   docker exec jawab24-backend-green npx tsx src/scripts/recover-disconnected-pages.ts --apply --user <user-id>
 *
 * Idempotent: re-running after a successful recovery is a no-op (the user is
 * no longer in the "all pages empty" set). Safe to re-run after partial failure.
 */
import { db } from '../db';
import { pages, users } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { facebookService } from '../services/facebook';
import { maybeDecryptToken, maybeEncryptToken } from '../services/facebookCrypto';
import { FacebookApiError, isTokenRevoked } from '../utils/fbGraphErrors';
import { clearReconnectAlertClaims } from '../services/pageTokenRecovery';

interface Args {
    apply: boolean;
    targetUserId: string | null;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const apply = argv.includes('--apply');
    const userIdx = argv.indexOf('--user');
    const targetUserId = userIdx >= 0 && argv[userIdx + 1] ? argv[userIdx + 1] : null;
    return { apply, targetUserId };
}

interface AffectedUser {
    userId: string;
    email: string | null;
    encryptedUserToken: string | null;
    pageCount: number;
}

/**
 * Find users where every one of their pages has an empty access_token.
 * Partial disconnects (some pages still connected) are excluded — those are
 * more likely to be real revocations of specific pages.
 */
async function findAffectedUsers(targetUserId: string | null): Promise<AffectedUser[]> {
    // SQL: group by user, count pages, count empties — keep users where empties == total
    const filter = targetUserId
        ? sql`AND p.user_id = ${targetUserId}`
        : sql``;
    const rows = await db.execute<{
        user_id: string;
        email: string | null;
        facebook_access_token: string | null;
        page_count: string;
    }>(sql`
        SELECT
            p.user_id,
            u.email,
            u.facebook_access_token,
            COUNT(*) AS page_count
        FROM ${pages} p
        JOIN ${users} u ON u.id = p.user_id
        WHERE p.user_id IS NOT NULL
          ${filter}
        GROUP BY p.user_id, u.email, u.facebook_access_token
        HAVING COUNT(*) = COUNT(*) FILTER (WHERE p.access_token = '')
           AND COUNT(*) > 0
        ORDER BY u.email
    `);

    const list = Array.isArray(rows) ? rows : (rows as { rows?: typeof rows }).rows ?? [];
    return (list as Array<{ user_id: string; email: string | null; facebook_access_token: string | null; page_count: string }>).map(r => ({
        userId: r.user_id,
        email: r.email,
        encryptedUserToken: r.facebook_access_token,
        pageCount: Number(r.page_count),
    }));
}

interface RecoveryResult {
    userId: string;
    email: string | null;
    status: 'recovered' | 'user_token_revoked' | 'no_user_token' | 'no_pages_returned' | 'error';
    pagesUpdated: number;
    detail?: string;
}

async function recoverUser(user: AffectedUser, apply: boolean): Promise<RecoveryResult> {
    if (!user.encryptedUserToken) {
        return {
            userId: user.userId,
            email: user.email,
            status: 'no_user_token',
            pagesUpdated: 0,
            detail: 'User has no stored facebook_access_token — manual reconnect required',
        };
    }

    let userToken: string;
    try {
        userToken = maybeDecryptToken(user.encryptedUserToken);
    } catch (err) {
        return {
            userId: user.userId,
            email: user.email,
            status: 'error',
            pagesUpdated: 0,
            detail: `Token decryption failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }

    let pagesResponse: Awaited<ReturnType<typeof facebookService.getUserPages>>;
    try {
        pagesResponse = await facebookService.getUserPages(userToken);
    } catch (err) {
        if (err instanceof FacebookApiError && isTokenRevoked(err)) {
            return {
                userId: user.userId,
                email: user.email,
                status: 'user_token_revoked',
                pagesUpdated: 0,
                detail: `FB rejected user token (code=${err.code}, subcode=${err.subcode ?? 'n/a'}). Manual reconnect required.`,
            };
        }
        return {
            userId: user.userId,
            email: user.email,
            status: 'error',
            pagesUpdated: 0,
            detail: `FB call failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }

    const fbPages = pagesResponse.data ?? [];
    if (fbPages.length === 0) {
        return {
            userId: user.userId,
            email: user.email,
            status: 'no_pages_returned',
            pagesUpdated: 0,
            detail: 'FB user token works but /me/accounts returned no pages — user may have removed pages from the app.',
        };
    }

    const fbPageMap = new Map(fbPages.map(p => [p.id, p.access_token]));

    // Look up the user's pages in our DB and find which ones FB returned tokens for
    const dbPages = await db
        .select({ id: pages.id, facebookPageId: pages.facebookPageId, name: pages.name })
        .from(pages)
        .where(eq(pages.userId, user.userId));

    let updated = 0;
    for (const dbPage of dbPages) {
        if (!dbPage.facebookPageId) continue;
        const freshToken = fbPageMap.get(dbPage.facebookPageId);
        if (!freshToken) continue;

        if (apply) {
            await db
                .update(pages)
                .set({
                    accessToken: maybeEncryptToken(freshToken),
                    tokenLastVerifiedAt: new Date(),
                    disconnectReason: null,
                    updatedAt: new Date(),
                })
                .where(eq(pages.id, dbPage.id));
            // Same contract as every other token-restore site: release the
            // reconnect-alert dedup claims so a later re-revocation alerts.
            clearReconnectAlertClaims(dbPage.id, user.userId);
        }
        updated++;
    }

    return {
        userId: user.userId,
        email: user.email,
        status: 'recovered',
        pagesUpdated: updated,
        detail: apply
            ? `Restored ${updated}/${dbPages.length} page tokens`
            : `Would restore ${updated}/${dbPages.length} page tokens (dry-run)`,
    };
}

async function main() {
    const args = parseArgs();
    const mode = args.apply ? 'APPLY' : 'DRY-RUN';
    console.warn(`[recovery] Mode: ${mode}${args.targetUserId ? ` (single user: ${args.targetUserId})` : ''}`);

    const affected = await findAffectedUsers(args.targetUserId);
    console.warn(`[recovery] Found ${affected.length} user(s) with all pages disconnected`);

    if (affected.length === 0) {
        console.warn('[recovery] Nothing to do.');
        return;
    }

    const results: RecoveryResult[] = [];
    for (const user of affected) {
        process.stdout.write(`[recovery] ${user.email ?? user.userId} (${user.pageCount} pages) ... `);
        const result = await recoverUser(user, args.apply);
        results.push(result);
        process.stdout.write(`${result.status} — ${result.detail ?? ''}\n`);

        // Rate-limit between FB calls to avoid hammering the API
        await new Promise(r => setTimeout(r, 1000));
    }

    // Summary
    const counts: Record<RecoveryResult['status'], number> = {
        recovered: 0,
        user_token_revoked: 0,
        no_user_token: 0,
        no_pages_returned: 0,
        error: 0,
    };
    let totalPages = 0;
    for (const r of results) {
        counts[r.status]++;
        totalPages += r.pagesUpdated;
    }

    console.warn('\n[recovery] Summary:');
    console.warn(`  Recovered:           ${counts.recovered} user(s), ${totalPages} page token(s) ${args.apply ? 'restored' : 'would be restored'}`);
    console.warn(`  User token revoked:  ${counts.user_token_revoked} (manual reconnect required)`);
    console.warn(`  No stored token:     ${counts.no_user_token} (manual reconnect required)`);
    console.warn(`  FB returned 0 pages: ${counts.no_pages_returned}`);
    console.warn(`  Errors:              ${counts.error}`);
    if (!args.apply) {
        console.warn('\n[recovery] DRY-RUN complete. Re-run with --apply to actually restore tokens.');
    }
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('[recovery] Fatal error:', err);
        process.exit(1);
    });
