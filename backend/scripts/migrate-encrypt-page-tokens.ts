/**
 * One-time migration: encrypt all plaintext Facebook page access tokens.
 *
 * Usage:
 *   npx tsx backend/scripts/migrate-encrypt-page-tokens.ts
 *
 * Safe to re-run — skips already-encrypted tokens and empty strings.
 * Requires FACEBOOK_TOKEN_ENCRYPTION_KEY in environment.
 */
import { db } from '../src/db';
import { pages } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { encryptFbToken, isEncrypted } from '../src/services/facebookCrypto';
import { config } from '../src/config';

async function main() {
    if (!config.facebook.tokenEncryptionKey) {
        console.error('FACEBOOK_TOKEN_ENCRYPTION_KEY is not set. Aborting.');
        process.exit(1);
    }

    const allPages = await db.select({ id: pages.id, accessToken: pages.accessToken }).from(pages);

    let encrypted = 0;
    let skipped = 0;

    for (const page of allPages) {
        // Skip empty tokens (disconnected pages) and already-encrypted tokens
        if (!page.accessToken || page.accessToken === '' || isEncrypted(page.accessToken)) {
            skipped++;
            continue;
        }

        const encryptedToken = encryptFbToken(page.accessToken);
        await db.update(pages)
            .set({ accessToken: encryptedToken })
            .where(eq(pages.id, page.id));

        encrypted++;
    }

    console.log(`Done. Encrypted: ${encrypted}, Skipped: ${skipped} (already encrypted or empty).`);
}


main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
