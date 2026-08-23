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
    mockVerifyPageToken,
    mockSendNotification,
} = vi.hoisted(() => ({
    mockDbUpdate: vi.fn(),
    mockDbSelect: vi.fn(),
    mockGetUserPages: vi.fn(),
    mockVerifyPageToken: vi.fn(),
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
    pages: { id: 'id', userId: 'user_id', accessToken: 'access_token', tokenLastVerifiedAt: 'token_last_verified_at', updatedAt: 'updated_at', facebookPageId: 'facebook_page_id', name: 'name', disconnectReason: 'disconnect_reason' },
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
        verifyPageToken: (...args: unknown[]) => mockVerifyPageToken(...args),
        setLogger: vi.fn(),
    },
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendNotification: mockSendNotification,
    },
}));

// crypto passthrough — encrypt/decrypt strip the enc:v1: prefix in tests so
// assertions can verify the sweep decrypts before calling FB.
vi.mock('../../src/services/facebookCrypto', () => ({
    maybeEncryptToken: (token: string) => token,
    maybeDecryptToken: (token: string | null | undefined) =>
        token && token.startsWith('enc:v1:') ? token.slice('enc:v1:'.length) : (token ?? ''),
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

/** The writes that disconnect a page — the only writes the regressions below guard against. */
function tokenClearWrites(setMock: ReturnType<typeof vi.fn>) {
    return setMock.mock.calls.filter(([v]) => (v as { accessToken?: string }).accessToken === '');
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
        // Default: every page token is valid against its own page (pass 1), so
        // the pre-existing cases keep exercising the /me/accounts refresh (pass 2).
        mockVerifyPageToken.mockResolvedValue(undefined);
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

        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);

        const result = await verifyAndRefreshTokens();

        // No clear, no notification sent (pass 1 only stamped tokenLastVerifiedAt)
        expect(tokenClearWrites(updateChain._setMock)).toHaveLength(0);
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
        expect(tokenClearWrites(updateChain._setMock)).toHaveLength(1);
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

    // 2026-08-23: a store-provisioned account (Zid/Salla install) has no user
    // token at all — its page was linked through the embedded break-out and its
    // PAGE token is perfectly valid. The old sweep disconnected every such page
    // on its first visit. A page is judged by its own token.
    it('a user with no facebook token keeps a page whose own token is valid', async () => {
        const stalePages = [pageRow({ id: 'p1', facebookPageId: 'fb-1' })];
        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: null }));

        const result = await verifyAndRefreshTokens();

        expect(tokenClearWrites(updateChain._setMock)).toHaveLength(0);
        expect(updateChain._setMock).toHaveBeenCalledWith(expect.objectContaining({
            tokenLastVerifiedAt: expect.any(Date),
            disconnectReason: null,
        }));
        expect(mockSendNotification).not.toHaveBeenCalled();
        expect(mockGetUserPages).not.toHaveBeenCalled();
        expect(result).toEqual({ verified: 1, refreshed: 0, invalid: 0 });
    });

    it('PROD 2026-08-23: a page-level revoke (page token → code 190, user token untouched) disconnects THAT page only', async () => {
        // «Jawab24 Test»: Meta dropped the app's access to one page after a later
        // Facebook Login ticked a different subset. The user token still works and
        // /me/accounts simply no longer lists the page — which the old sweep left
        // intact, so the page ignored every customer for 7+ hours.
        const stalePages = [
            pageRow({ id: 'p-dead', facebookPageId: 'fb-dead', name: 'Jawab24 Test' }),
            pageRow({ id: 'p-ok', facebookPageId: 'fb-ok', name: 'Healthy' }),
        ];
        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: 'user-token' }));
        mockVerifyPageToken.mockImplementation(async (fbPageId: string) => {
            if (fbPageId === 'fb-dead') {
                throw new FacebookApiError('Page token verification failed', { code: 190, isTransport: false });
            }
        });
        mockGetUserPages.mockResolvedValue({ data: [{ id: 'fb-ok', access_token: 'fresh-ok' }] });

        const result = await verifyAndRefreshTokens();

        // Exactly one clear, for the dead page, with the definitive reason.
        const clears = tokenClearWrites(updateChain._setMock);
        expect(clears).toHaveLength(1);
        expect(clears[0][0]).toMatchObject({ accessToken: '', disconnectReason: 'token_revoked' });
        expect(mockSendNotification).toHaveBeenCalledTimes(1);
        expect(mockSendNotification).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ type: 'page_disconnected' }));
        // The healthy sibling was verified directly AND refreshed from /me/accounts.
        expect(updateChain._setMock).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'fresh-ok' }));
        expect(result).toEqual({ verified: 1, refreshed: 1, invalid: 1 });
    });

    it('a transport failure on the direct page check leaves the token intact (never a revoke)', async () => {
        const stalePages = [pageRow({ id: 'p1', facebookPageId: 'fb-1' })];
        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: null }));
        mockVerifyPageToken.mockRejectedValue(new FacebookApiError('Facebook API error: timeout', { isTransport: true }));

        const result = await verifyAndRefreshTokens();

        expect(mockDbUpdate).not.toHaveBeenCalled();
        expect(mockSendNotification).not.toHaveBeenCalled();
        expect(result).toEqual({ verified: 0, refreshed: 0, invalid: 0 });
    });

    it('sends the DECRYPTED page token to Graph, not the enc:v1: blob', async () => {
        const stalePages = [pageRow({ id: 'p1', facebookPageId: 'fb-1', accessToken: 'enc:v1:plain-page-token' })];
        mockDbUpdate.mockReturnValue(buildUpdateChain());
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: null }));

        await verifyAndRefreshTokens();

        expect(mockVerifyPageToken).toHaveBeenCalledWith('fb-1', 'plain-page-token');
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
        expect(updateChain._setMock).toHaveBeenCalledWith(expect.objectContaining({
            accessToken: 'fresh-token-1',
            tokenLastVerifiedAt: expect.any(Date),
        }));
        expect(updateChain._setMock).toHaveBeenCalledWith(expect.objectContaining({
            accessToken: 'fresh-token-2',
        }));
        expect(mockSendNotification).not.toHaveBeenCalled();
        expect(result.refreshed).toBe(2);
        expect(result.verified).toBe(2);
        expect(result.invalid).toBe(0);
    });

    it('regression: decrypts encrypted user token before calling FB (enc:v1: prefix)', async () => {
        // Reproduces the 2026-05-08 incident: 24 pages across 8 paying merchants
        // were wrongly disconnected because tokenRefresh sent the raw enc:v1: blob
        // to Facebook, which returned code 190 with a malformed-token message.
        const stalePages = [pageRow({ id: 'p1', facebookPageId: 'fb-1', name: 'Page 1' })];
        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);
        mockDbSelect
            .mockReturnValueOnce(buildStalePagesQuery(stalePages))
            .mockReturnValueOnce(buildUserSelectQuery({ facebookAccessToken: 'enc:v1:plaintext-user-token' }));

        mockGetUserPages.mockResolvedValue({
            data: [{ id: 'fb-1', access_token: 'fresh-token-1' }],
        });

        await verifyAndRefreshTokens();

        // FB must receive the decrypted token, not the enc:v1: blob.
        expect(mockGetUserPages).toHaveBeenCalledWith('plaintext-user-token');
        expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('regression: retry-exhaustion on transient errors does NOT clear tokens', async () => {
        const stalePages = [pageRow({ id: 'p1', facebookPageId: 'fb-1', name: 'Page 1' })];
        const updateChain = buildUpdateChain();
        mockDbUpdate.mockReturnValue(updateChain);
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
        expect(tokenClearWrites(updateChain._setMock)).toHaveLength(0);
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

        // Only user-2's page got refreshed; nobody was cleared
        expect(updateChain._setMock).toHaveBeenCalledWith(expect.objectContaining({
            accessToken: 'fresh-u2',
        }));
        expect(updateChain._setMock).not.toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'fresh-u1' }));
        expect(tokenClearWrites(updateChain._setMock)).toHaveLength(0);
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

    it.each(revokedCases)('returns true for code=%i subcode=%s (%s)', (code, subcode) => {
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

    it.each(notRevokedCases)('returns false for: %s', (err) => {
        expect(isTokenRevoked(err)).toBe(false);
    });

    it('also recognises DmSendError with revoked code (since it shares fields with FacebookApiError)', () => {
        const dmErr = new DmSendError('test', { code: 190, subcode: 460, isTransport: false });
        expect(isTokenRevoked(dmErr)).toBe(true);
    });
});
