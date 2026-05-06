import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FacebookApiError, isTokenRevoked, DmSendError } from '../../src/utils/fbGraphErrors';

// ── Mocks ────────────────────────────────────────────────────────────────────
//
// vi.hoisted() is required: vi.mock factories are hoisted to the top of the file,
// so any `const` they reference must exist before module evaluation.

const {
    mockDbUpdate,
    mockDbSelect,
    mockGetUserPages,
    mockSendNotification,
} = vi.hoisted(() => ({
    mockDbUpdate: vi.fn(),
    mockDbSelect: vi.fn(),
    mockGetUserPages: vi.fn(),
    mockSendNotification: vi.fn().mockResolvedValue('notif-id'),
}));

vi.mock('../../src/db', () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
        update: (...args: unknown[]) => mockDbUpdate(...args),
    },
}));

// schema: drizzle needs these to exist; the mock content doesn't affect behavior
// because we mock the query builders below.
vi.mock('../../src/db/schema', () => ({
    pages: { id: 'id', userId: 'user_id', accessToken: 'access_token', tokenLastVerifiedAt: 'token_last_verified_at', updatedAt: 'updated_at', facebookPageId: 'facebook_page_id', name: 'name' },
    users: { id: 'id', facebookAccessToken: 'facebook_access_token', facebookTokenExpiresAt: 'facebook_token_expires_at' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    ne: vi.fn((field, value) => ({ field, value, op: 'ne' })),
    and: vi.fn((...args: unknown[]) => ({ args, op: 'and' })),
    or: vi.fn((...args: unknown[]) => ({ args, op: 'or' })),
    isNotNull: vi.fn((field) => ({ field, op: 'isNotNull' })),
    isNull: vi.fn((field) => ({ field, op: 'isNull' })),
    lt: vi.fn((field, value) => ({ field, value, op: 'lt' })),
    inArray: vi.fn((field, values) => ({ field, values, op: 'inArray' })),
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getUserPages: (...args: unknown[]) => mockGetUserPages(...args),
        setLogger: vi.fn(),
    },
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendNotification: mockSendNotification,
    },
}));

// crypto passthrough — encrypt is identity in tests
vi.mock('../../src/services/facebookCrypto', () => ({
    maybeEncryptToken: (token: string) => token,
}));

// sentry helper — no-op
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

// retry: keep retryableErrors semantics but strip delays so tests run instantly
vi.mock('../../src/utils/retry', () => ({
    withRetry: vi.fn(async (fn: () => Promise<unknown>, opts?: { maxAttempts?: number; retryableErrors?: (e: unknown) => boolean }) => {
        const max = opts?.maxAttempts ?? 3;
        let lastErr: unknown;
        for (let i = 0; i < max; i++) {
            try { return await fn(); }
            catch (e) {
                lastErr = e;
                if (i === max - 1) throw e;
                if (opts?.retryableErrors && !opts.retryableErrors(e)) throw e;
            }
        }
        throw lastErr;
    }),
}));

// ── Imports under test (after mocks) ──────────────────────────────────────────

import { verifyAndRefreshTokens } from '../../src/services/tokenRefresh';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const USER_2_ID = 'user-2';

function buildStalePagesQuery(rows: unknown[]) {
    // Mimic Drizzle's chainable query builder for the initial stalePages select
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
        }),
    };
}

function buildUserSelectQuery(userRow: { facebookAccessToken: string | null }) {
    // Mimic the limit-1 select for user.facebookAccessToken
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(userRow ? [userRow] : []),
            }),
        }),
    };
}

function buildUpdateChain() {
    // Mimic db.update(pages).set(...).where(...)
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    return { set: setMock, _setMock: setMock };
}

function pageRow(overrides: Partial<{ id: string; facebookPageId: string; name: string; accessToken: string; userId: string }> = {}) {
    return {
        id: overrides.id ?? 'page-1',
        facebookPageId: overrides.facebookPageId ?? 'fb-1',
        name: overrides.name ?? 'Test Page',
        accessToken: overrides.accessToken ?? 'old-token',
        userId: overrides.userId ?? USER_ID,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('tokenRefresh.verifyAndRefreshTokens', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it('regression: transient /me/accounts failure does NOT clear page tokens', async () => {
        // Three pages for one user
        const stalePages = [
            pageRow({ id: 'p1', facebookPageId: 'fb-1', name: 'Page 1' }),
            pageRow({ id: 'p2', facebookPageId: 'fb-2', name: 'Page 2' }),
            pageRow({ id: 'p3', facebookPageId: 'fb-3', name: 'Page 3' }),
        ];
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: 'user-token' }));

        // FB returns 503 — transient (transport-layer)
        mockGetUserPages.mockRejectedValue(
            new FacebookApiError('Facebook API error: Service Unavailable', { isTransport: true }),
        );

        const result = await verifyAndRefreshTokens();

        // No clear, no notification sent
        expect(mockDbUpdate).not.toHaveBeenCalled();
        expect(mockSendNotification).not.toHaveBeenCalled();
        expect(result.invalid).toBe(0);
    });

    it('clears tokens and notifies on confirmed token-revoked error (190/460 password changed)', async () => {
        const stalePages = [
            pageRow({ id: 'p1', facebookPageId: 'fb-1', name: 'Page 1' }),
            pageRow({ id: 'p2', facebookPageId: 'fb-2', name: 'Page 2' }),
        ];
        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: 'user-token' }));

        // Real password-changed error from FB
        mockGetUserPages.mockRejectedValue(
            new FacebookApiError('Facebook API error: Password changed', {
                code: 190,
                subcode: 460,
                isTransport: false,
            }),
        );

        const result = await verifyAndRefreshTokens();

        // notifyReconnectNeeded was called → tokens cleared + notification sent
        expect(mockDbUpdate).toHaveBeenCalledTimes(1);
        expect(updateChain._setMock).toHaveBeenCalledWith(expect.objectContaining({
            accessToken: '',
            disconnectReason: 'token_revoked',
        }));
        expect(mockSendNotification).toHaveBeenCalledWith(
            USER_ID,
            expect.objectContaining({ type: 'page_disconnected' }),
        );
        expect(result.invalid).toBe(2);
    });

    it('uses disconnect_reason="no_user_token" when user has no stored facebook token', async () => {
        const stalePages = [pageRow({ id: 'p1', facebookPageId: 'fb-1' })];
        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: null }));

        const result = await verifyAndRefreshTokens();

        expect(updateChain._setMock).toHaveBeenCalledWith(expect.objectContaining({
            accessToken: '',
            disconnectReason: 'no_user_token',
        }));
        expect(result.invalid).toBe(1);
    });

    it('clears disconnect_reason on successful token refresh (recovered page)', async () => {
        const stalePages = [pageRow({ id: 'p1', facebookPageId: 'fb-1' })];
        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: 'user-token' }));

        mockGetUserPages.mockResolvedValue({
            data: [{ id: 'fb-1', access_token: 'fresh-token' }],
        });

        await verifyAndRefreshTokens();

        // The success path explicitly sets disconnectReason to null so a recovered
        // page doesn't show stale state in support queries.
        expect(updateChain._setMock).toHaveBeenCalledWith(expect.objectContaining({
            accessToken: 'fresh-token',
            disconnectReason: null,
        }));
    });

    it('refreshes page tokens when /me/accounts succeeds', async () => {
        const stalePages = [
            pageRow({ id: 'p1', facebookPageId: 'fb-1', name: 'Page 1' }),
            pageRow({ id: 'p2', facebookPageId: 'fb-2', name: 'Page 2' }),
        ];
        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: 'user-token' }));

        mockGetUserPages.mockResolvedValue({
            data: [
                { id: 'fb-1', access_token: 'fresh-token-1' },
                { id: 'fb-2', access_token: 'fresh-token-2' },
            ],
        });

        const result = await verifyAndRefreshTokens();

        // Each page got a fresh token written + tokenLastVerifiedAt updated
        expect(mockDbUpdate).toHaveBeenCalledTimes(2);
        expect(updateChain._setMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            accessToken: 'fresh-token-1',
            tokenLastVerifiedAt: expect.any(Date),
        }));
        expect(updateChain._setMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            accessToken: 'fresh-token-2',
        }));
        expect(mockSendNotification).not.toHaveBeenCalled();
        expect(result.refreshed).toBe(2);
        expect(result.verified).toBe(2);
        expect(result.invalid).toBe(0);
    });

    it('regression: retry-exhaustion on transient errors does NOT clear tokens', async () => {
        const stalePages = [pageRow({ id: 'p1', facebookPageId: 'fb-1', name: 'Page 1' })];
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: 'user-token' }));

        // Three transient failures in a row
        const transientErr = new FacebookApiError('Facebook API error: timeout', { isTransport: true });
        mockGetUserPages
            .mockRejectedValueOnce(transientErr)
            .mockRejectedValueOnce(transientErr)
            .mockRejectedValueOnce(transientErr);

        const result = await verifyAndRefreshTokens();

        // withRetry called the inner fn 3 times (max attempts)
        expect(mockGetUserPages).toHaveBeenCalledTimes(3);
        // But pages were NEVER cleared — that's the regression we're guarding against
        expect(mockDbUpdate).not.toHaveBeenCalled();
        expect(mockSendNotification).not.toHaveBeenCalled();
        expect(result.invalid).toBe(0);
    });

    it('per-user isolation: one user fails transiently, other user pages still refresh', async () => {
        const stalePages = [
            pageRow({ id: 'p1-u1', facebookPageId: 'fb-1', userId: USER_ID }),
            pageRow({ id: 'p1-u2', facebookPageId: 'fb-2', userId: USER_2_ID }),
        ];
        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);

        // Initial stalePages query, then one user-select per user (in iteration order)
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: 'user-1-token' }))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: 'user-2-token' }));

        // First user transient fails, second succeeds
        mockGetUserPages
            .mockRejectedValueOnce(new FacebookApiError('Facebook API error: timeout', { isTransport: true }))
            .mockRejectedValueOnce(new FacebookApiError('Facebook API error: timeout', { isTransport: true }))
            .mockRejectedValueOnce(new FacebookApiError('Facebook API error: timeout', { isTransport: true }))
            .mockResolvedValueOnce({ data: [{ id: 'fb-2', access_token: 'fresh-u2' }] });

        const result = await verifyAndRefreshTokens();

        // Only user-2's page got refreshed (one update call total)
        expect(mockDbUpdate).toHaveBeenCalledTimes(1);
        expect(updateChain._setMock).toHaveBeenCalledWith(expect.objectContaining({
            accessToken: 'fresh-u2',
        }));
        // No tokens cleared — user-1's transient failure must NOT cascade
        expect(mockSendNotification).not.toHaveBeenCalled();
        expect(result.refreshed).toBe(1);
    }, 10000);
});

describe('isTokenRevoked', () => {
    const revokedCases: Array<[number, number | undefined, string]> = [
        [190, 458, 'session invalidated'],
        [190, 459, 'user checkpointed'],
        [190, 460, 'password changed'],
        [190, 463, 'token expired'],
        [190, 467, 'invalid token'],
        [200, 10,  'permission revoked'],
        [190, undefined, '190 with no subcode (catch-all)'],
        [190, 999, '190 with unknown subcode (still treated as revoked)'],
    ];

    it.each(revokedCases)('returns true for code=%i subcode=%s (%s)', (code, subcode, _label) => {
        const err = new FacebookApiError('test', { code, subcode, isTransport: false });
        expect(isTokenRevoked(err)).toBe(true);
    });

    const notRevokedCases: Array<[unknown, string]> = [
        [new FacebookApiError('test', { code: 190, isTransport: true }), 'transport-layer 190 (still transient — retry, not clear)'],
        [new FacebookApiError('test', { code: 4 }), 'app-level rate limit (code 4)'],
        [new FacebookApiError('test', { code: 613 }), 'rate limit (code 613)'],
        [new FacebookApiError('test', { isTransport: true }), 'pure network error (no code)'],
        [new Error('Plain old error'), 'plain Error instance'],
        ['just a string', 'non-error value'],
        [null, 'null'],
    ];

    it.each(notRevokedCases)('returns false for: %s', (err, _label) => {
        expect(isTokenRevoked(err)).toBe(false);
    });

    it('also recognises DmSendError with revoked code (since it shares fields with FacebookApiError)', () => {
        const dmErr = new DmSendError('test', { code: 190, subcode: 460, isTransport: false });
        expect(isTokenRevoked(dmErr)).toBe(true);
    });
});
