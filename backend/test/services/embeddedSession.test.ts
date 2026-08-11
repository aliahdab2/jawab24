/**
 * Embedded-app session exchange — unit tests.
 *
 * The security-critical behaviour of the Zid "direct merchant access" flow
 * lives here: the credential is hashed before lookup, the minted session is
 * SCOPED to the store's workspace and stripped of admin, an unscopable store is
 * refused rather than handed an all-access token, and every refusal is one
 * discriminated reason (the caller collapses them to an opaque 401).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetStoreByEmbeddedTokenHash = vi.fn();
const mockTouchEmbeddedTokenUse = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/ecommerce', () => ({
    getStoreByEmbeddedTokenHash: (...a: unknown[]) => mockGetStoreByEmbeddedTokenHash(...a),
    touchEmbeddedTokenUse: (...a: unknown[]) => mockTouchEmbeddedTokenUse(...a),
}));

const mockGetUserById = vi.fn();
const mockGenerateToken = vi.fn().mockReturnValue('minted.access.token');
vi.mock('../../src/services/auth', () => ({
    authService: {
        getUserById: (...a: unknown[]) => mockGetUserById(...a),
        generateToken: (...a: unknown[]) => mockGenerateToken(...a),
    },
}));

const mockResolveDefaultWorkspaceId = vi.fn();
vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        resolveDefaultWorkspaceId: (...a: unknown[]) => mockResolveDefaultWorkspaceId(...a),
    },
}));

const mockCaptureError = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...a: unknown[]) => mockCaptureError(...a),
}));

import { exchangeEmbeddedCredential, hashEmbeddedToken } from '../../src/services/embeddedSession';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

// SHA-256 of 'uuid-abc' — pinned so a change to the hashing scheme (which would
// silently invalidate every merchant's dashboard entry) fails here.
const UUID = 'uuid-abc';
const UUID_SHA256 = 'f882fa969acc48a6f894cf5d848a464e781e088f197ce25b265d6724c9083c6a';
const STORE = { id: 'store-1', userId: 'owner-1', workspaceId: 'ws-1', storeName: 'My Zid Store' };
const OWNER = { id: 'owner-1', isAdmin: false };

beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateToken.mockReturnValue('minted.access.token');
    mockTouchEmbeddedTokenUse.mockResolvedValue(undefined);
});

describe('hashEmbeddedToken', () => {
    it('is the SHA-256 hex of the input', () => {
        expect(hashEmbeddedToken(UUID)).toBe(UUID_SHA256);
    });
});

describe('exchangeEmbeddedCredential', () => {
    it('looks the credential up by DIGEST, never by its raw value', async () => {
        mockGetStoreByEmbeddedTokenHash.mockResolvedValueOnce(STORE);
        mockGetUserById.mockResolvedValueOnce(OWNER);

        await exchangeEmbeddedCredential('zid', UUID, log);

        const [platform, lookupArg] = mockGetStoreByEmbeddedTokenHash.mock.calls[0];
        expect(platform).toBe('zid');
        expect(lookupArg).toBe(UUID_SHA256);
        expect(lookupArg).not.toBe(UUID);
    });

    it('mints a token SCOPED to the store workspace and stripped of admin', async () => {
        mockGetStoreByEmbeddedTokenHash.mockResolvedValueOnce(STORE);
        mockGetUserById.mockResolvedValueOnce(OWNER);

        const result = await exchangeEmbeddedCredential('zid', UUID, log);

        expect(result).toEqual({ ok: true, session: { accessToken: 'minted.access.token', workspaceId: 'ws-1', storeId: 'store-1' } });
        // Third arg is the scope: this is the whole C-1 fix. Default expiry
        // (2nd arg undefined) keeps it short-lived.
        expect(mockGenerateToken).toHaveBeenCalledWith(OWNER, undefined, { embeddedPlatform: 'zid', workspaceId: 'ws-1' });
    });

    it('pushes out the idle clock after a successful exchange', async () => {
        mockGetStoreByEmbeddedTokenHash.mockResolvedValueOnce(STORE);
        mockGetUserById.mockResolvedValueOnce(OWNER);

        await exchangeEmbeddedCredential('zid', UUID, log);

        expect(mockTouchEmbeddedTokenUse).toHaveBeenCalledWith('store-1');
    });

    it('refuses a missing credential without touching the database', async () => {
        const result = await exchangeEmbeddedCredential('zid', undefined, log);

        expect(result).toEqual({ ok: false, reason: 'missing-token' });
        expect(mockGetStoreByEmbeddedTokenHash).not.toHaveBeenCalled();
    });

    it('refuses an unknown / rotated / expired credential and never mints a token', async () => {
        mockGetStoreByEmbeddedTokenHash.mockResolvedValueOnce(null);

        const result = await exchangeEmbeddedCredential('zid', 'stale', log);

        expect(result).toEqual({ ok: false, reason: 'unknown-or-expired-credential' });
        expect(mockGenerateToken).not.toHaveBeenCalled();
    });

    it('refuses (owner-missing) and reports to Sentry when the store owner is gone', async () => {
        mockGetStoreByEmbeddedTokenHash.mockResolvedValueOnce(STORE);
        mockGetUserById.mockResolvedValueOnce(null);

        const result = await exchangeEmbeddedCredential('zid', UUID, log);

        expect(result).toEqual({ ok: false, reason: 'owner-missing' });
        expect(mockGenerateToken).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('falls back to the resolver when the store row carries no workspace', async () => {
        mockGetStoreByEmbeddedTokenHash.mockResolvedValueOnce({ ...STORE, workspaceId: null });
        mockGetUserById.mockResolvedValueOnce(OWNER);
        mockResolveDefaultWorkspaceId.mockResolvedValueOnce('resolved-ws');

        const result = await exchangeEmbeddedCredential('zid', UUID, log);

        expect(result).toMatchObject({ ok: true, session: { workspaceId: 'resolved-ws' } });
        expect(mockGenerateToken).toHaveBeenCalledWith(OWNER, undefined, { embeddedPlatform: 'zid', workspaceId: 'resolved-ws' });
    });

    it('REFUSES rather than mint an unscoped token when no workspace can be found', async () => {
        mockGetStoreByEmbeddedTokenHash.mockResolvedValueOnce({ ...STORE, workspaceId: null });
        mockGetUserById.mockResolvedValueOnce(OWNER);
        mockResolveDefaultWorkspaceId.mockResolvedValueOnce(null);

        const result = await exchangeEmbeddedCredential('zid', UUID, log);

        // An unpinned embedded session is the exact vulnerability this guards.
        expect(result).toEqual({ ok: false, reason: 'no-workspace' });
        expect(mockGenerateToken).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('still returns the session when the idle-clock write fails (fire-and-forget)', async () => {
        mockGetStoreByEmbeddedTokenHash.mockResolvedValueOnce(STORE);
        mockGetUserById.mockResolvedValueOnce(OWNER);
        mockTouchEmbeddedTokenUse.mockRejectedValueOnce(new Error('db down'));

        const result = await exchangeEmbeddedCredential('zid', UUID, log);

        expect(result).toMatchObject({ ok: true });
    });
});
