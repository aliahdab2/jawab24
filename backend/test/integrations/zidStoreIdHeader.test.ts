import { describe, it, expect, vi, beforeEach } from 'vitest';

// Zid's non-/managers store API (GET /v1/products/) returns
// 401 {"detail":"No such user"} unless a Store-Id header carrying the numeric
// merchant id is sent — captured live 2026-08-22. These tests pin that the
// Store-Id header is forwarded on Zid API calls and sourced from
// platformData.merchantId. See docs/integrations/zid.md.

vi.mock('../../src/config', () => ({
    config: { zid: { clientId: '', clientSecret: '', hostName: '', appId: '', webhookSecret: '', scopes: '' } },
}));
vi.mock('@sentry/node', () => ({ startSpan: vi.fn((_o, fn) => fn()) }));
vi.mock('../../src/utils/tracing', () => ({ tracedExternalCall: (_p: unknown, _n: unknown, fn: () => unknown) => fn() }));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

// Capture the options ecommerceApiGet is called with — this is the seam that
// carries the assembled headers.
const mockApiGet = vi.fn().mockResolvedValue({ results: [] });
vi.mock('../../src/utils/httpRetry', () => ({
    ecommerceApiGet: (...args: unknown[]) => mockApiGet(...args),
}));

const mockGetStoreById = vi.fn();
vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
    replaceProductsAndRebuildSummary: vi.fn(),
    applySyncedStoreInfo: vi.fn(),
    PRODUCT_SAFETY_CAP: 5000,
}));

const mockResolvePair = vi.fn();
vi.mock('../../src/services/ecommerceTokenRefresh', () => ({
    resolveStoreCredentialPair: (...args: unknown[]) => mockResolvePair(...args),
    refreshAccessToken: vi.fn(),
    ensureValidToken: vi.fn(),
    getStoresNeedingTokenRefresh: vi.fn(),
    refreshExpiringTokens: vi.fn(),
}));

import { zidApiGet, resolveZidCredentials } from '../../src/services/zid';

const extraHeadersOf = (call: unknown[]) => (call[1] as { extraHeaders?: Record<string, string> }).extraHeaders ?? {};

describe('zidApiGet Store-Id header', () => {
    beforeEach(() => mockApiGet.mockClear());

    it('sends Store-Id (and both tokens) when creds carry a storeId', async () => {
        await zidApiGet('https://api.zid.sa/v1/products/', {
            managerToken: 'mgr', authorizationToken: 'auth', storeId: '3195980',
        });
        const opts = mockApiGet.mock.calls[0][1] as { authHeaderValue: string; extraHeaders: Record<string, string> };
        expect(opts.authHeaderValue).toBe('Bearer auth');
        expect(opts.extraHeaders['X-Manager-Token']).toBe('mgr');
        expect(opts.extraHeaders['Store-Id']).toBe('3195980');
    });

    it('omits Store-Id when creds have no storeId (e.g. a /managers/ profile call at callback time)', async () => {
        await zidApiGet('https://api.zid.sa/v1/managers/account/profile', {
            managerToken: 'mgr', authorizationToken: 'auth',
        });
        expect(extraHeadersOf(mockApiGet.mock.calls[0])).not.toHaveProperty('Store-Id');
    });

    it('does not send the retired Role: Manager header', async () => {
        await zidApiGet('https://api.zid.sa/v1/products/', {
            managerToken: 'mgr', authorizationToken: 'auth', storeId: '3195980',
        });
        expect(extraHeadersOf(mockApiGet.mock.calls[0])).not.toHaveProperty('Role');
    });
});

describe('resolveZidCredentials sources storeId from platformData.merchantId', () => {
    beforeEach(() => { mockResolvePair.mockReset(); mockGetStoreById.mockReset(); });

    it('populates storeId from platformData.merchantId', async () => {
        mockResolvePair.mockResolvedValue({ accessToken: 'mgr', authorizationToken: 'auth' });
        mockGetStoreById.mockResolvedValue({ platformData: { merchantId: '3195980' } });
        const creds = await resolveZidCredentials('internal-uuid');
        expect(creds).toEqual({ managerToken: 'mgr', authorizationToken: 'auth', storeId: '3195980' });
    });

    it('leaves storeId undefined when merchantId is absent (pre-dual-token row)', async () => {
        mockResolvePair.mockResolvedValue({ accessToken: 'mgr', authorizationToken: 'auth' });
        mockGetStoreById.mockResolvedValue({ platformData: {} });
        const creds = await resolveZidCredentials('internal-uuid');
        expect(creds?.storeId).toBeUndefined();
    });

    it('returns null when the store credential pair is missing', async () => {
        mockResolvePair.mockResolvedValue(null);
        expect(await resolveZidCredentials('internal-uuid')).toBeNull();
    });
});
