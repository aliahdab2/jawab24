/**
 * Token encryption at rest — end-to-end integration coverage.
 *
 * FACEBOOK_TOKEN_ENCRYPTION_KEY is set in ./setup.ts (mirrors production),
 * so service write paths store enc:v1: ciphertext and read paths decrypt.
 * Raw fixture inserts (plaintext via testDb) exercise the legacy passthrough.
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, createTestUser, createTestWorkspace, createTestPage } from './setup';
import * as schema from '../../src/db/schema';
import { pagesService } from '../../src/services/pages';
import { isEncrypted, encryptFbToken } from '../../src/services/facebookCrypto';
import { serializePage } from '../../src/controllers/pages';
import { backfillTokenEncryption } from '../../scripts/migrate-encrypt-page-tokens';

const PLAINTEXT_TOKEN = 'EAABsbCS4iNw-integration-page-token';

describe('page token encryption at rest — integration', () => {
    it('createPage stores enc:v1: ciphertext in the DB; getPage/getPages return plaintext', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);

        const created = await pagesService.createPage(workspace.id, user.id, {
            facebookPageId: 'fb-enc-test-1',
            name: 'Encrypted Page',
            accessToken: PLAINTEXT_TOKEN,
        });

        // At rest: ciphertext, never the plaintext
        const [dbRow] = await testDb
            .select()
            .from(schema.pages)
            .where(eq(schema.pages.id, created.id));
        expect(isEncrypted(dbRow.accessToken)).toBe(true);
        expect(dbRow.accessToken).not.toContain(PLAINTEXT_TOKEN);

        // Read paths: transparent decryption
        const single = await pagesService.getPage(workspace.id, created.id);
        expect(single?.accessToken).toBe(PLAINTEXT_TOKEN);

        const list = await pagesService.getPages(workspace.id);
        expect(list.find(p => p.id === created.id)?.accessToken).toBe(PLAINTEXT_TOKEN);
    });

    it('legacy plaintext rows pass through unchanged (pre-encryption compat)', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, {
            workspaceId: workspace.id,
            accessToken: 'legacy-plaintext-token',
        });

        const fetched = await pagesService.getPage(workspace.id, page.id);
        expect(fetched?.accessToken).toBe('legacy-plaintext-token');
    });

    it('one corrupt encrypted row does not break getPages for the workspace', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const healthy = await createTestPage(user.id, {
            workspaceId: workspace.id,
            facebookPageId: 'fb-healthy',
            accessToken: encryptFbToken('healthy-token'),
        });
        const corrupt = await createTestPage(user.id, {
            workspaceId: workspace.id,
            facebookPageId: 'fb-corrupt',
            accessToken: `enc:v1:${'aa'.repeat(16)}:broken-ciphertext.c2hvcnQ=`,
        });

        const list = await pagesService.getPages(workspace.id);

        // Healthy page decrypts; corrupt page surfaces as disconnected ('')
        expect(list.find(p => p.id === healthy.id)?.accessToken).toBe('healthy-token');
        expect(list.find(p => p.id === corrupt.id)?.accessToken).toBe('');
    });

    it('serializePage strips accessToken from API responses and derives isConnected', () => {
        // A real Facebook page always has a facebookPageId; isConnected tracks its FB token.
        const connected = serializePage({ id: 'p1', facebookPageId: 'fb-p1', accessToken: 'tok' });
        expect(connected).not.toHaveProperty('accessToken');
        expect(connected.isConnected).toBe(true);

        const disconnected = serializePage({ id: 'p2', facebookPageId: 'fb-p2', accessToken: '' });
        expect(disconnected.isConnected).toBe(false);

        // WhatsApp-only card (facebookPageId null): isConnected tracks the WABA token, not the FB one.
        const whatsappOnly = serializePage({ id: 'p3', facebookPageId: null, accessToken: '', whatsappAccessToken: 'waba-tok' });
        expect(whatsappOnly).not.toHaveProperty('whatsappAccessToken');
        expect(whatsappOnly.isConnected).toBe(true);
        expect(whatsappOnly.whatsappConnected).toBe(true);
    });
});

describe('backfillTokenEncryption — integration', () => {
    it('encrypts plaintext page AND user tokens, skips encrypted/empty, and is idempotent', async () => {
        const user = await createTestUser({ facebookAccessToken: 'plain-user-token' });
        const userNoToken = await createTestUser({
            facebookId: 'fb-user-2',
            email: 'two@example.com',
            facebookAccessToken: null,
        });
        const workspace = await createTestWorkspace(user.id);

        const plainPage = await createTestPage(user.id, {
            workspaceId: workspace.id,
            facebookPageId: 'fb-plain',
            accessToken: 'plain-page-token',
        });
        const encryptedPage = await createTestPage(user.id, {
            workspaceId: workspace.id,
            facebookPageId: 'fb-already-enc',
            accessToken: encryptFbToken('already-encrypted-token'),
        });
        const emptyPage = await createTestPage(user.id, {
            workspaceId: workspace.id,
            facebookPageId: 'fb-disconnected',
            accessToken: '',
        });

        const first = await backfillTokenEncryption();
        expect(first.pagesEncrypted).toBe(1);
        expect(first.usersEncrypted).toBe(1);

        // Plaintext rows are now ciphertext and still decryptable via the service
        const [plainRow] = await testDb.select().from(schema.pages).where(eq(schema.pages.id, plainPage.id));
        expect(isEncrypted(plainRow.accessToken)).toBe(true);
        const viaService = await pagesService.getPage(workspace.id, plainPage.id);
        expect(viaService?.accessToken).toBe('plain-page-token');

        const [userRow] = await testDb.select().from(schema.users).where(eq(schema.users.id, user.id));
        expect(userRow.facebookAccessToken && isEncrypted(userRow.facebookAccessToken)).toBe(true);

        // Untouched: already-encrypted, empty sentinel, and null user token
        const [encRow] = await testDb.select().from(schema.pages).where(eq(schema.pages.id, encryptedPage.id));
        expect(encRow.accessToken).toBe(encryptedPage.accessToken);
        const [emptyRow] = await testDb.select().from(schema.pages).where(eq(schema.pages.id, emptyPage.id));
        expect(emptyRow.accessToken).toBe('');
        const [noTokenRow] = await testDb.select().from(schema.users).where(eq(schema.users.id, userNoToken.id));
        expect(noTokenRow.facebookAccessToken).toBeNull();

        // Idempotency: a second run encrypts nothing new
        const second = await backfillTokenEncryption();
        expect(second.pagesEncrypted).toBe(0);
        expect(second.usersEncrypted).toBe(0);
    });
});
