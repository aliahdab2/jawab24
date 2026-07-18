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

const { capturedInserts, capturedDeletes, capturedSelects, mockSelectLimit, mockUpdateWhere, mockListResult } = vi.hoisted(() => ({
    capturedInserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
    capturedDeletes: [] as Array<{ table: unknown }>,
    capturedSelects: [] as unknown[],
    mockSelectLimit: vi.fn().mockResolvedValue([]),
    mockUpdateWhere: vi.fn().mockResolvedValue(undefined),
    mockListResult: vi.fn().mockResolvedValue([]),
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
        select: vi.fn().mockImplementation((cols?: unknown) => ({
            from: vi.fn().mockImplementation(() => {
                capturedSelects.push(cols);
                return {
                    where: vi.fn().mockReturnValue({
                        limit: mockSelectLimit,
                        // claimByMerchantId: where().orderBy().limit(); listPendingInstalls: where().orderBy() (awaited, no limit)
                        orderBy: vi.fn().mockReturnValue({
                            limit: mockSelectLimit,
                            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => mockListResult().then(resolve, reject),
                        }),
                    }),
                };
            }),
        })),
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
        delete: vi.fn().mockImplementation((table: unknown) => {
            capturedDeletes.push({ table });
            return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) };
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
        tokenExpiresAt: 'tokenExpiresAt', scopes: 'scopes', merchantId: 'merchantId', storeName: 'storeName',
        nonce: 'nonce', status: 'status', claimedByUserId: 'claimedByUserId', expiresAt: 'expiresAt',
        createdAt: 'createdAt',
    },
    workspaceMembers: { id: 'id', workspaceId: 'workspaceId', userId: 'userId', role: 'role' },
}));

// Import after mocks
import {
    createPendingInstall,
    claimPendingInstall,
    claimPendingInstallByMerchantId,
    listPendingInstalls,
    ClaimOwnershipError,
} from '../../src/services/ecommerce';
import { encrypt, encryptOptional, decrypt } from '../../src/services/ecommerceCrypto';
import { pendingEcommerceInstalls, ecommerceStores } from '../../src/db/schema';

const findInsert = (table: unknown) => capturedInserts.find(i => i.table === table);

describe('Pending-install token persistence (Salla/Zid refresh tokens)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedInserts.length = 0;
        capturedDeletes.length = 0;
        capturedSelects.length = 0;
        mockSelectLimit.mockResolvedValue([]);
        mockListResult.mockResolvedValue([]);
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

describe('Salla Easy Mode pending install (merchant-id keyed claim)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedInserts.length = 0;
        capturedDeletes.length = 0;
        capturedSelects.length = 0;
        mockSelectLimit.mockResolvedValue([]);
        mockListResult.mockResolvedValue([]);
    });

    const pendingDeletes = () => capturedDeletes.filter(d => d.table === pendingEcommerceInstalls).length;

    it('createPendingInstall persists merchantId + storeName, dedups by merchant too, and honors a custom TTL', async () => {
        await createPendingInstall('salla', {
            storeDomain: 'demo.salla.sa',
            storeName: 'متجر تجريبي',
            merchantId: '671738424',
            accessToken: 'easy_access',
            refreshToken: 'easy_refresh',
            nonce: '',
            ttlMs: 7 * 24 * 60 * 60 * 1000,
        });

        const pending = findInsert(pendingEcommerceInstalls);
        expect(pending!.values.merchantId).toBe('671738424');
        expect(pending!.values.storeName).toBe('متجر تجريبي');
        // Easy Mode runs BOTH the storeDomain dedup AND the merchant dedup (2 deletes).
        expect(pendingDeletes()).toBe(2);
        // Custom TTL ~7 days out (not the 30-minute default).
        expect((pending!.values.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    });

    it('createPendingInstall (cookie flow, no merchantId) runs only the storeDomain dedup and stores null merchant fields', async () => {
        await createPendingInstall('salla', { storeDomain: 'demo.salla.sa', accessToken: 'a', nonce: 'n' });

        expect(pendingDeletes()).toBe(1);
        const pending = findInsert(pendingEcommerceInstalls);
        expect(pending!.values.merchantId).toBeNull();
        expect(pending!.values.storeName).toBeNull();
        // Default 30-minute TTL.
        expect((pending!.values.expiresAt as Date).getTime()).toBeLessThan(Date.now() + 60 * 60 * 1000);
    });

    it('claimPendingInstallByMerchantId finds the row and carries the merchantId into the store platformData', async () => {
        const accessEnc = encrypt('easy_access');
        const refreshEnc = encryptOptional('easy_refresh');
        mockSelectLimit
            // 1) pending lookup by merchant (where().orderBy().limit())
            .mockResolvedValueOnce([{
                id: 'pending-em', platform: 'salla', storeDomain: 'demo.salla.sa', merchantId: '671738424',
                accessToken: accessEnc.ciphertext, accessTokenIv: accessEnc.iv,
                refreshToken: refreshEnc.ciphertext, refreshTokenIv: refreshEnc.iv,
                tokenExpiresAt: null, status: 'pending', expiresAt: new Date(Date.now() + 300000),
            }])
            // 2) getStoreByDomain → none existing
            .mockResolvedValueOnce([])
            // 3) workspace members
            .mockResolvedValueOnce([{ workspaceId: 'ws-1' }]);

        const store = await claimPendingInstallByMerchantId('671738424', 'user-123', 'salla');
        expect(store).toBeTruthy();

        const storeInsert = findInsert(ecommerceStores);
        // A merchantId-bearing pending row is an Easy-Mode install (only app.store.authorize
        // stages one), so the claimed store is stamped tokenSource:'easy_mode' — this lets the
        // proactive pull-refresh skip it when SALLA_SKIP_PULL_REFRESH_EASY_MODE is on.
        expect(storeInsert!.values.platformData).toEqual({ merchantId: '671738424', tokenSource: 'easy_mode' });
        // tokens round-trip through the claim
        expect(decrypt(storeInsert!.values.refreshToken as string, storeInsert!.values.refreshTokenIv as string)).toBe('easy_refresh');
    });

    it('claimPendingInstallByMerchantId returns null when no pending row matches', async () => {
        mockSelectLimit.mockResolvedValueOnce([]);
        const store = await claimPendingInstallByMerchantId('999', 'user-123', 'salla');
        expect(store).toBeNull();
    });

    it('listPendingInstalls returns NON-secret columns only (never tokens/nonce)', async () => {
        mockListResult.mockResolvedValueOnce([
            { id: 'p1', storeDomain: 'demo.salla.sa', storeName: 'Shop', merchantId: '671738424', createdAt: new Date() },
        ]);

        const rows = await listPendingInstalls('salla', '671738424');
        expect(rows).toHaveLength(1);

        // Assert the source selected ONLY non-secret columns (the columns-object call).
        const colsArg = capturedSelects.find(c => c && typeof c === 'object') as Record<string, unknown>;
        expect(Object.keys(colsArg).sort()).toEqual(['createdAt', 'id', 'merchantId', 'storeDomain', 'storeName']);
        expect(colsArg).not.toHaveProperty('accessToken');
        expect(colsArg).not.toHaveProperty('refreshToken');
        expect(colsArg).not.toHaveProperty('nonce');
    });
});

describe('Ownership verifier — Easy Mode claim binding (D-012)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedInserts.length = 0;
        capturedDeletes.length = 0;
        capturedSelects.length = 0;
        // Full RESET (not just clear): rejection tests abort mid-claim, leaving queued
        // mockResolvedValueOnce entries that clearAllMocks would carry into the next test.
        mockSelectLimit.mockReset();
        mockSelectLimit.mockResolvedValue([]);
        mockListResult.mockResolvedValue([]);
    });

    /** Stage the 3 selects a claim performs: pending row → getStoreByDomain → workspace. */
    const stagePendingRow = () => {
        const accessEnc = encrypt('salla_access_abc');
        mockSelectLimit
            .mockResolvedValueOnce([{
                id: 'pending-own', platform: 'salla', storeDomain: 'demo.salla.sa',
                accessToken: accessEnc.ciphertext, accessTokenIv: accessEnc.iv,
                refreshToken: null, refreshTokenIv: null, tokenExpiresAt: null,
                merchantId: '2108580704',
                status: 'pending', expiresAt: new Date(Date.now() + 300000),
            }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ workspaceId: 'ws-1' }]);
    };

    it('receives the DECRYPTED access token and the claim proceeds when it returns true', async () => {
        stagePendingRow();
        const verifier = vi.fn().mockResolvedValue(true);

        const store = await claimPendingInstall('pending-own', 'user-123', 'salla', undefined, undefined, verifier);

        expect(verifier).toHaveBeenCalledWith('salla_access_abc');
        expect(store).toBeTruthy();
        expect(findInsert(ecommerceStores)).toBeDefined();
        expect(mockUpdateWhere).toHaveBeenCalled(); // pending row marked claimed
    });

    it('throws ClaimOwnershipError and writes NOTHING when the verifier returns false', async () => {
        stagePendingRow();
        const verifier = vi.fn().mockResolvedValue(false);

        await expect(
            claimPendingInstall('pending-own', 'user-123', 'salla', undefined, undefined, verifier),
        ).rejects.toBeInstanceOf(ClaimOwnershipError);

        // The pending row stays pending and no store row was created — the merchant
        // can retry from the right account without re-installing.
        expect(findInsert(ecommerceStores)).toBeUndefined();
        expect(mockUpdateWhere).not.toHaveBeenCalled();
    });

    it('claimPendingInstallByMerchantId enforces the same gate', async () => {
        stagePendingRow();
        const verifier = vi.fn().mockResolvedValue(false);

        await expect(
            claimPendingInstallByMerchantId('2108580704', 'user-123', 'salla', undefined, undefined, verifier),
        ).rejects.toBeInstanceOf(ClaimOwnershipError);
        expect(findInsert(ecommerceStores)).toBeUndefined();
        expect(mockUpdateWhere).not.toHaveBeenCalled();
    });

    it('propagates a verifier exception without writing (verification unavailable ≠ mismatch)', async () => {
        stagePendingRow();
        const verifier = vi.fn().mockRejectedValue(new Error('salla api down'));

        await expect(
            claimPendingInstall('pending-own', 'user-123', 'salla', undefined, undefined, verifier),
        ).rejects.toThrow('salla api down');
        expect(findInsert(ecommerceStores)).toBeUndefined();
        expect(mockUpdateWhere).not.toHaveBeenCalled();
    });

    it('claims WITHOUT a verifier keep working (cookie/OAuth flow — ownership proven upstream)', async () => {
        stagePendingRow();
        const store = await claimPendingInstall('pending-own', 'user-123', 'salla');
        expect(store).toBeTruthy();
        expect(findInsert(ecommerceStores)).toBeDefined();
    });
});
