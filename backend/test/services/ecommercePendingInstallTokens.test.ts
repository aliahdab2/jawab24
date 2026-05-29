import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guard for the Salla/Zid App Store install blocker:
 * the merchant-first (logged-out) install path runs through
 * `pending_ecommerce_installs` → `claimPendingInstall`. Before the fix it
 * stored only the access token, so the claimed store had no refresh token and
 * silently died when the token expired (Salla: 14 days).
 *
 * Uses REAL crypto so the encrypt-on-create → decrypt-on-claim → re-encrypt
 * round-trip is genuinely exercised; only the DB layer is mocked.
 */

process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY = 'test-encryption-key-must-be-32-chars-long!!';

const { capturedInserts, mockSelectLimit, mockUpdateWhere } = vi.hoisted(() => ({
    capturedInserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
    mockSelectLimit: vi.fn().mockResolvedValue([]),
    mockUpdateWhere: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/config', () => ({
    config: { shopify: { tokenEncryptionKey: 'test-encryption-key-must-be-32-chars-long!!' } },
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { scan: vi.fn(), del: vi.fn(), get: vi.fn(), set: vi.fn(), quit: vi.fn() },
    redisScanDelete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: { seedDefaults: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ limit: mockSelectLimit }),
            }),
        }),
        insert: vi.fn().mockImplementation((table: unknown) => ({
            values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
                capturedInserts.push({ table, values });
                return {
                    // createPendingInstall: insert().values().returning()
                    returning: vi.fn().mockResolvedValue([{ id: 'pending-generated-id' }]),
                    // createStore: insert().values().onConflictDoUpdate().returning()
                    onConflictDoUpdate: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([
                            { id: 'store-new', userId: 'user-123', isActive: true },
                        ]),
                    }),
                };
            }),
        })),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: mockUpdateWhere }) }),
        delete: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    ecommerceStores: {
        id: 'id', storeDomain: 'storeDomain', userId: 'userId', workspaceId: 'workspaceId',
        isActive: 'isActive', platform: 'platform',
    },
    ecommerceProducts: { ecommerceStoreId: 'ecommerceStoreId', status: 'status' },
    pages: { id: 'id', userId: 'userId', workspaceId: 'workspaceId', ecommerceStoreId: 'ecommerceStoreId' },
    pendingEcommerceInstalls: {
        id: 'id', platform: 'platform', storeDomain: 'storeDomain', accessToken: 'accessToken',
        accessTokenIv: 'accessTokenIv', refreshToken: 'refreshToken', refreshTokenIv: 'refreshTokenIv',
        tokenExpiresAt: 'tokenExpiresAt', scopes: 'scopes', nonce: 'nonce', status: 'status',
        claimedByUserId: 'claimedByUserId', expiresAt: 'expiresAt',
    },
    workspaceMembers: { id: 'id', workspaceId: 'workspaceId', userId: 'userId', role: 'role' },
}));

// Import after mocks
import { createPendingInstall, claimPendingInstall } from '../../src/services/ecommerce';
import { encrypt, encryptOptional, decrypt } from '../../src/services/ecommerceCrypto';
import { pendingEcommerceInstalls, ecommerceStores } from '../../src/db/schema';

const findInsert = (table: unknown) => capturedInserts.find(i => i.table === table);

describe('Pending-install token persistence (Salla/Zid refresh tokens)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedInserts.length = 0;
        mockSelectLimit.mockResolvedValue([]);
    });

    it('createPendingInstall persists an encrypted refresh token + expiry', async () => {
        const expiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

        await createPendingInstall('salla', {
            storeDomain: 'demo.salla.sa',
            accessToken: 'salla_access_abc',
            refreshToken: 'salla_refresh_xyz',
            tokenExpiresAt: expiry,
            nonce: 'nonce123',
        });

        const pending = findInsert(pendingEcommerceInstalls);
        expect(pending).toBeDefined();
        expect(pending!.values.refreshToken).toBeTruthy();
        expect(pending!.values.refreshTokenIv).toBeTruthy();
        expect(pending!.values.tokenExpiresAt).toEqual(expiry);
        // Round-trip: the stored ciphertext decrypts back to the original token.
        expect(decrypt(
            pending!.values.refreshToken as string,
            pending!.values.refreshTokenIv as string,
        )).toBe('salla_refresh_xyz');
    });

    it('createPendingInstall leaves refresh fields empty when no refresh token is supplied (Shopify)', async () => {
        await createPendingInstall('shopify', {
            storeDomain: 'demo.myshopify.com',
            accessToken: 'shpat_access',
            nonce: 'nonce123',
        });

        const pending = findInsert(pendingEcommerceInstalls);
        expect(pending).toBeDefined();
        expect(pending!.values.refreshToken).toBeUndefined();
        expect(pending!.values.refreshTokenIv).toBeUndefined();
        expect(pending!.values.tokenExpiresAt).toBeUndefined();
    });

    it('claimPendingInstall forwards the refresh token + expiry to the created store', async () => {
        const expiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const accessEnc = encrypt('salla_access_abc');
        const refreshEnc = encryptOptional('salla_refresh_xyz');

        mockSelectLimit
            // 1) pending lookup
            .mockResolvedValueOnce([{
                id: 'pending-1', platform: 'salla', storeDomain: 'demo.salla.sa',
                accessToken: accessEnc.ciphertext, accessTokenIv: accessEnc.iv,
                refreshToken: refreshEnc.ciphertext, refreshTokenIv: refreshEnc.iv,
                tokenExpiresAt: expiry,
                status: 'pending', expiresAt: new Date(Date.now() + 300000),
            }])
            // 2) getStoreByDomain → none existing
            .mockResolvedValueOnce([])
            // 3) workspace members lookup
            .mockResolvedValueOnce([{ workspaceId: 'ws-1' }]);

        const store = await claimPendingInstall('pending-1', 'user-123', 'salla');
        expect(store).toBeTruthy();

        const storeInsert = findInsert(ecommerceStores);
        expect(storeInsert).toBeDefined();
        expect(storeInsert!.values.refreshToken).toBeTruthy();
        expect(storeInsert!.values.refreshTokenIv).toBeTruthy();
        expect(storeInsert!.values.tokenExpiresAt).toEqual(expiry);
        // Round-trip: the store's encrypted refresh token decrypts to the original.
        expect(decrypt(
            storeInsert!.values.refreshToken as string,
            storeInsert!.values.refreshTokenIv as string,
        )).toBe('salla_refresh_xyz');
    });

    it('claimPendingInstall still succeeds for a row with no refresh token (Shopify / pre-migration rows)', async () => {
        const accessEnc = encrypt('shpat_access');

        mockSelectLimit
            .mockResolvedValueOnce([{
                id: 'pending-2', platform: 'shopify', storeDomain: 'demo.myshopify.com',
                accessToken: accessEnc.ciphertext, accessTokenIv: accessEnc.iv,
                refreshToken: null, refreshTokenIv: null, tokenExpiresAt: null,
                status: 'pending', expiresAt: new Date(Date.now() + 300000),
            }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ workspaceId: 'ws-1' }]);

        const store = await claimPendingInstall('pending-2', 'user-123', 'shopify');
        expect(store).toBeTruthy();

        const storeInsert = findInsert(ecommerceStores);
        expect(storeInsert).toBeDefined();
        // No decrypt attempted on a null pair; store created with empty refresh fields.
        expect(storeInsert!.values.refreshToken).toBeUndefined();
        expect(storeInsert!.values.refreshTokenIv).toBeUndefined();
        expect(storeInsert!.values.tokenExpiresAt).toBeUndefined();
    });
});
