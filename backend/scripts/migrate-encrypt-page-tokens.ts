/**
 * One-time migration: encrypt all plaintext Facebook tokens at rest.
 * Covers pages.access_token AND users.facebook_access_token.
 *
 * Usage:
 *   npx tsx backend/scripts/migrate-encrypt-page-tokens.ts
 *
 * Safe to re-run — skips already-encrypted tokens and empty strings.
 * Requires FACEBOOK_TOKEN_ENCRYPTION_KEY in environment.
 */
import { db } from '../src/db';
import { pages, users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { encryptFbToken, isEncrypted } from '../src/services/facebookCrypto';
import { config } from '../src/config';

export interface BackfillResult {
    pagesEncrypted: number;
    usersEncrypted: number;
    skipped: number;
}

export async function backfillTokenEncryption(): Promise<BackfillResult> {
    if (!config.facebook.tokenEncryptionKey) {
        throw new Error('FACEBOOK_TOKEN_ENCRYPTION_KEY is not set. Aborting.');
    }

    let pagesEncrypted = 0;
    let usersEncrypted = 0;
    let skipped = 0;

    const allPages = await db.select({ id: pages.id, accessToken: pages.accessToken }).from(pages);
    for (const page of allPages) {
        // Skip empty tokens (disconnected-page sentinel) and already-encrypted tokens
        if (!page.accessToken || isEncrypted(page.accessToken)) {
            skipped++;
            continue;
        }
        await db.update(pages)
            .set({ accessToken: encryptFbToken(page.accessToken) })
            .where(eq(pages.id, page.id));
        pagesEncrypted++;
    }

    const allUsers = await db
        .select({ id: users.id, facebookAccessToken: users.facebookAccessToken })
        .from(users);
    for (const user of allUsers) {
        if (!user.facebookAccessToken || isEncrypted(user.facebookAccessToken)) {
            skipped++;
            continue;
        }
        await db.update(users)
            .set({ facebookAccessToken: encryptFbToken(user.facebookAccessToken) })
            .where(eq(users.id, user.id));
        usersEncrypted++;
    }

    return { pagesEncrypted, usersEncrypted, skipped };
}

// CLI entry — argv guard so importing from tests doesn't auto-run the backfill.
if (process.argv[1] && process.argv[1].includes('migrate-encrypt-page-tokens')) {
    backfillTokenEncryption()
        .then(res => {
            console.log(
                `Done. Pages encrypted: ${res.pagesEncrypted}, users encrypted: ${res.usersEncrypted}, ` +
                `skipped: ${res.skipped} (already encrypted or empty).`,
            );
            process.exit(0);
        })
        .catch(err => {
            console.error('Migration failed:', err);
            process.exit(1);
        });
}
