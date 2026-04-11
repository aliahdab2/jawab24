import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TokenRefreshConfig } from '../../src/services/ecommerceTokenRefresh';

// --- Mocks (must be hoisted before imports) ---

const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();
vi.mock('../../src/lib/redis', () => ({
    redis: {
        set: (...args: unknown[]) => mockRedisSet(...args),
        del: (...args: unknown[]) => mockRedisDel(...args),
    },
}));

const mockGetStoreById = vi.fn();
const mockUpdateStoreTokens = vi.fn();
vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
    updateStoreTokens: (...args: unknown[]) => mockUpdateStoreTokens(...args),
}));

// Mock DB (getStoresNeedingTokenRefresh uses it directly)
const mockDbWhere = vi.fn().mockResolvedValue([]);
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: (...args: unknown[]) => mockDbWhere(...args),
    },
}));

vi.mock('../../src/db/schema', () => ({
    ecommerceStores: {},
}));

// Mock ecommerceCrypto
vi.mock('../../src/services/ecommerceCrypto', () => ({
    decrypt: vi.fn((_cipher: string, _iv: string) => 'decrypted-refresh-token'),
}));

// Mock sentryHelpers
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

// Mock tracing
vi.mock('../../src/utils/tracing', () => ({
    tracedExternalCall: vi.fn((_p: string, _o: string, fn: () => unknown) => fn()),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// --- Helpers ---

const testConfig: TokenRefreshConfig = {
    platform: 'salla',
    tokenEndpointUrl: 'https://accounts.salla.sa/oauth2/token',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
};

function makeResponse(status: number, body: unknown): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
}

function futureDate(ms: number): Date {
    return new Date(Date.now() + ms);
}

// --- Tests ---

import {
    refreshAccessToken,
    ensureValidToken,
    refreshExpiringTokens,
} from '../../src/services/ecommerceTokenRefresh';

describe('refreshAccessToken', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockRedisDel.mockResolvedValue(1);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('waits and returns when lock is not acquired (concurrent refresh)', async () => {
        mockRedisSet.mockResolvedValueOnce(null); // lock NOT acquired

        const promise = refreshAccessToken('store-1', testConfig);
        // LOCK_WAIT_DELAY_MS = 2000 — advance past it
        await vi.advanceTimersByTimeAsync(2001);
        await promise;

        // Should not call getStoreById at all
        expect(mockGetStoreById).not.toHaveBeenCalled();
        expect(mockUpdateStoreTokens).not.toHaveBeenCalled();
    });

    it('skips refresh if token still valid for > 24h', async () => {
        mockRedisSet.mockResolvedValueOnce('OK'); // lock acquired
        mockGetStoreById.mockResolvedValueOnce({
            id: 'store-1',
            tokenExpiresAt: futureDate(2 * 24 * 60 * 60 * 1000), // 2 days from now
            refreshToken: 'encrypted',
            refreshTokenIv: 'iv',
        });

        await refreshAccessToken('store-1', testConfig);
        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockUpdateStoreTokens).not.toHaveBeenCalled();
    });

    it('throws when store is not found', async () => {
        mockRedisSet.mockResolvedValueOnce('OK');
        mockGetStoreById.mockResolvedValueOnce(null);

        await expect(refreshAccessToken('store-missing', testConfig)).rejects.toThrow('Store not found');
    });

    it('throws when no refresh token is stored', async () => {
        mockRedisSet.mockResolvedValueOnce('OK');
        mockGetStoreById.mockResolvedValueOnce({
            id: 'store-1',
            tokenExpiresAt: futureDate(1000), // expiring soon
            refreshToken: null,
            refreshTokenIv: null,
        });

        await expect(refreshAccessToken('store-1', testConfig)).rejects.toThrow('No refresh token');
    });

    it('refreshes token and updates store when token is expiring', async () => {
        mockRedisSet.mockResolvedValueOnce('OK');
        mockGetStoreById.mockResolvedValueOnce({
            id: 'store-1',
            tokenExpiresAt: futureDate(60 * 60 * 1000), // 1h from now (< 24h threshold)
            refreshToken: 'encrypted-refresh',
            refreshTokenIv: 'iv123',
        });
        mockFetch.mockResolvedValueOnce(makeResponse(200, {
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 3600,
        }));
        mockUpdateStoreTokens.mockResolvedValueOnce(undefined);

        await refreshAccessToken('store-1', testConfig);

        expect(mockFetch).toHaveBeenCalledWith(
            'https://accounts.salla.sa/oauth2/token',
            expect.objectContaining({ method: 'POST' }),
        );
        expect(mockUpdateStoreTokens).toHaveBeenCalledWith('store-1', expect.objectContaining({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
        }));
    });

    it('always releases the Redis lock even when refresh fails', async () => {
        mockRedisSet.mockResolvedValueOnce('OK');
        mockGetStoreById.mockResolvedValueOnce({
            id: 'store-1',
            tokenExpiresAt: futureDate(1000),
            refreshToken: 'enc',
            refreshTokenIv: 'iv',
        });
        mockFetch.mockResolvedValueOnce(makeResponse(500, { error: 'server error' }));

        await expect(refreshAccessToken('store-1', testConfig)).rejects.toThrow();
        expect(mockRedisDel).toHaveBeenCalledWith('salla:token_refresh:store-1');
    });

    it('throws on non-OK token endpoint response', async () => {
        mockRedisSet.mockResolvedValueOnce('OK');
        mockGetStoreById.mockResolvedValueOnce({
            id: 'store-1',
            tokenExpiresAt: futureDate(1000),
            refreshToken: 'enc',
            refreshTokenIv: 'iv',
        });
        mockFetch.mockResolvedValueOnce(makeResponse(401, { error: 'invalid_grant' }));

        await expect(refreshAccessToken('store-1', testConfig)).rejects.toThrow('salla token refresh failed: 401');
    });
});

describe('ensureValidToken', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRedisDel.mockResolvedValue(1);
    });

    it('does nothing when store has no expiry date set', async () => {
        mockGetStoreById.mockResolvedValueOnce({ id: 'store-1', tokenExpiresAt: null });
        await ensureValidToken('store-1', testConfig);
        expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('does nothing when token expires in more than 24h', async () => {
        mockGetStoreById.mockResolvedValueOnce({
            id: 'store-1',
            tokenExpiresAt: futureDate(2 * 24 * 60 * 60 * 1000),
        });
        await ensureValidToken('store-1', testConfig);
        expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('triggers refresh when token expires within 24h', async () => {
        // First call (ensureValidToken's own check)
        mockGetStoreById.mockResolvedValueOnce({
            id: 'store-1',
            tokenExpiresAt: futureDate(60 * 60 * 1000), // 1h
        });
        // Second call inside refreshAccessToken
        mockRedisSet.mockResolvedValueOnce('OK');
        mockGetStoreById.mockResolvedValueOnce({
            id: 'store-1',
            tokenExpiresAt: futureDate(60 * 60 * 1000),
            refreshToken: 'enc',
            refreshTokenIv: 'iv',
        });
        mockFetch.mockResolvedValueOnce(makeResponse(200, {
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 86400,
        }));
        mockUpdateStoreTokens.mockResolvedValueOnce(undefined);

        await ensureValidToken('store-1', testConfig);
        expect(mockUpdateStoreTokens).toHaveBeenCalled();
    });

    it('throws when store is not found', async () => {
        mockGetStoreById.mockResolvedValueOnce(null);
        await expect(ensureValidToken('missing', testConfig)).rejects.toThrow('Store not found');
    });
});

describe('refreshExpiringTokens', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockRedisDel.mockResolvedValue(1);
        mockDbWhere.mockResolvedValue([]); // default: no stores need refresh
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns 0 when no stores need refresh', async () => {
        const count = await refreshExpiringTokens(testConfig);
        expect(count).toBe(0);
    });

    it('refreshes each store and returns the count of successful refreshes', async () => {
        mockDbWhere.mockResolvedValueOnce([{ id: 'store-a' }, { id: 'store-b' }]);

        // Both stores: lock acquired, token expiring → refresh succeeds
        for (let i = 0; i < 2; i++) {
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValueOnce({
                id: `store-${i}`,
                tokenExpiresAt: futureDate(60 * 60 * 1000),
                refreshToken: 'enc',
                refreshTokenIv: 'iv',
            });
            mockFetch.mockResolvedValueOnce(makeResponse(200, {
                access_token: 'new-access',
                refresh_token: 'new-refresh',
                expires_in: 86400,
            }));
            mockUpdateStoreTokens.mockResolvedValueOnce(undefined);
        }

        const count = await refreshExpiringTokens(testConfig);
        expect(count).toBe(2);
        expect(mockUpdateStoreTokens).toHaveBeenCalledTimes(2);
    });

    it('continues refreshing remaining stores when one fails, and captures the error', async () => {
        const { captureError } = await import('../../src/utils/sentryHelpers');

        mockDbWhere.mockResolvedValueOnce([{ id: 'store-fail' }, { id: 'store-ok' }]);

        // store-fail: lock acquired, then fetch throws
        mockRedisSet.mockResolvedValueOnce('OK');
        mockGetStoreById.mockResolvedValueOnce({
            id: 'store-fail',
            tokenExpiresAt: futureDate(1000),
            refreshToken: 'enc',
            refreshTokenIv: 'iv',
        });
        mockFetch.mockRejectedValueOnce(new Error('network error'));

        // store-ok: lock acquired, refresh succeeds
        mockRedisSet.mockResolvedValueOnce('OK');
        mockGetStoreById.mockResolvedValueOnce({
            id: 'store-ok',
            tokenExpiresAt: futureDate(1000),
            refreshToken: 'enc',
            refreshTokenIv: 'iv',
        });
        mockFetch.mockResolvedValueOnce(makeResponse(200, {
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 86400,
        }));
        mockUpdateStoreTokens.mockResolvedValueOnce(undefined);

        const count = await refreshExpiringTokens(testConfig);

        // Only the successful store counts
        expect(count).toBe(1);
        // Error was captured via Sentry, not re-thrown
        expect(captureError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.stringContaining('store-fail'),
            expect.objectContaining({ tags: { service: 'salla' } }),
        );
    });
});
