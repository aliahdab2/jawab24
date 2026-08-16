import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * End-to-end coverage for the WhatsApp token health SWEEP.
 *
 * `assessToken` (the pure expiry maths) is unit-tested separately in
 * src/__tests__/whatsappTokenHealth.test.ts. This file covers the orchestration
 * around it, which is where the damage would be done: this sweep is the only
 * code in the system that CLEARS a live merchant's WhatsApp credential.
 *
 * The invariant every test here defends: **a healthy number must never be
 * disconnected.** Meta having a bad minute, a rotated encryption key, or a
 * non-expiring token must all leave the merchant untouched. Getting that wrong
 * silently stops a paying customer's replies — the exact failure this whole
 * feature exists to prevent.
 */

const {
    mockDbSelect,
    mockDbUpdate,
    mockDebugToken,
    mockSendTemplateNotification,
    mockCaptureError,
    mockDecrypt,
} = vi.hoisted(() => ({
    mockDbSelect: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockDebugToken: vi.fn(),
    mockSendTemplateNotification: vi.fn().mockResolvedValue('notif-id'),
    mockCaptureError: vi.fn(),
    mockDecrypt: vi.fn((t: string | null | undefined) =>
        t && t.startsWith('enc:v1:') ? t.slice('enc:v1:'.length) : (t ?? '')),
}));

vi.mock('../../src/db', () => ({
    db: {
        select: (...a: unknown[]) => mockDbSelect(...a),
        update: (...a: unknown[]) => mockDbUpdate(...a),
    },
}));

vi.mock('../../src/db/schema', () => ({
    pages: {
        id: 'id', name: 'name', userId: 'user_id', workspaceId: 'workspace_id',
        whatsappAccessToken: 'whatsapp_access_token',
        whatsappDisplayPhoneNumber: 'whatsapp_display_phone_number',
        whatsappTokenExpiresAt: 'whatsapp_token_expires_at',
        whatsappTokenLastVerifiedAt: 'whatsapp_token_last_verified_at',
        whatsappDisconnectReason: 'whatsapp_disconnect_reason',
        whatsappAutoReplyEnabled: 'whatsapp_auto_reply_enabled',
        updatedAt: 'updated_at',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((f, v) => ({ f, v, op: 'eq' })),
    ne: vi.fn((f, v) => ({ f, v, op: 'ne' })),
    and: vi.fn((...a: unknown[]) => ({ a, op: 'and' })),
    or: vi.fn((...a: unknown[]) => ({ a, op: 'or' })),
    isNotNull: vi.fn((f) => ({ f, op: 'isNotNull' })),
    isNull: vi.fn((f) => ({ f, op: 'isNull' })),
    lt: vi.fn((f, v) => ({ f, v, op: 'lt' })),
}));

// WhatsAppApiError must be a REAL class — the service branches on `instanceof`.
vi.mock('../../src/services/whatsapp', () => {
    class WhatsAppApiError extends Error {
        readonly metaCode?: number;
        readonly transient: boolean;
        constructor(message: string, metaCode?: number, transient = false) {
            super(message);
            this.name = 'WhatsAppApiError';
            this.metaCode = metaCode;
            this.transient = transient;
        }
    }
    return {
        WhatsAppApiError,
        META_TOKEN_EXPIRED: 190,
        whatsappService: { debugToken: (...a: unknown[]) => mockDebugToken(...a) },
    };
});

vi.mock('../../src/services/facebookCrypto', () => ({
    maybeDecryptToken: (t: string | null | undefined) => mockDecrypt(t),
    maybeEncryptToken: (t: string) => t,
}));

// Mirror the method the sweep ACTUALLY calls. Exposing a different one would make
// every `not.toHaveBeenCalled()` below pass vacuously: the call would throw
// "not a function", the service's catch would swallow it, and the spy would
// legitimately never fire.
vi.mock('../../src/services/notifications', () => ({
    notificationService: { sendTemplateNotification: mockSendTemplateNotification },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: mockCaptureError }));

// Strip retry delays but keep the retryableErrors semantics — the difference
// between "retried a blip" and "disconnected a merchant" lives in that matcher.
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

import { verifyWhatsAppTokens } from '../../src/services/whatsappTokenHealth';
import { WhatsAppApiError } from '../../src/services/whatsapp';

// ── helpers ──────────────────────────────────────────────────────────────────

function stalePages(rows: unknown[]) {
    return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }) };
}

/** Captures every `.set({...})` payload written during the sweep. */
function captureUpdates() {
    const sets: Record<string, unknown>[] = [];
    mockDbUpdate.mockReturnValue({
        set: vi.fn((vals: Record<string, unknown>) => {
            sets.push(vals);
            // `.where()` is awaited directly on the alive path and chained with
            // `.returning()` on the flag path (the conditional-update idempotency
            // gate), so the mock must satisfy both shapes.
            const where = vi.fn(() => {
                const chain = Promise.resolve(undefined) as Promise<unknown> & {
                    returning: () => Promise<Array<{ id: string }>>;
                };
                chain.returning = () => Promise.resolve([{ id: 'page-1' }]);
                return chain;
            });
            return { where };
        }),
    });
    return sets;
}

function waPage(over: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'page-1',
        name: 'Falafel House',
        userId: 'user-1',
        workspaceId: 'ws-1',
        whatsappAccessToken: 'enc:v1:wa-token',
        whatsappDisplayPhoneNumber: '+966 55 000 0000',
        ...over,
    };
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

/**
 * True when a `.set()` payload DESTROYS the credential.
 *
 * This must never be true. The sweep flags via `whatsapp_disconnect_reason` and
 * deliberately leaves the ciphertext in place, so a false positive is a banner
 * that clears itself rather than a forced re-onboarding. Kept as an explicit
 * assertion so a future change back to NULLing fails loudly here.
 */
const destroysCredential = (s: Record<string, unknown>) =>
    s.whatsappAccessToken === null || s.whatsappAccessToken === '';

/** True when a `.set()` payload flags the number as needing a reconnect. */
const flagsReconnect = (s: Record<string, unknown>) => !!s.whatsappDisconnectReason;

beforeEach(() => {
    vi.clearAllMocks();
    mockDecrypt.mockImplementation((t: string | null | undefined) =>
        t && t.startsWith('enc:v1:') ? t.slice('enc:v1:'.length) : (t ?? ''));
});

describe('verifyWhatsAppTokens — healthy numbers are never disconnected', () => {
    it('marks a healthy token verified without notifying or clearing it', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        const sets = captureUpdates();
        mockDebugToken.mockResolvedValue({ isValid: true, expiresAt: inDays(59), scopes: [], wabaIds: [] });

        const result = await verifyWhatsAppTokens();

        expect(result).toMatchObject({ checked: 1, expiringSoon: 0, dead: 0 });
        expect(sets).toHaveLength(1);
        expect(sets[0].whatsappTokenLastVerifiedAt).toBeInstanceOf(Date);
        expect(sets[0].whatsappDisconnectReason).toBeNull();
        expect(sets.some(destroysCredential)).toBe(false);
        expect(mockSendTemplateNotification).not.toHaveBeenCalled();
    });

    it('decrypts the stored token before calling Meta', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage({ whatsappAccessToken: 'enc:v1:plaintext-token' })]));
        captureUpdates();
        mockDebugToken.mockResolvedValue({ isValid: true, scopes: [], wabaIds: [] });

        await verifyWhatsAppTokens();

        // Sending ciphertext would make Meta return 190 and the sweep would
        // disconnect a perfectly live number — the exact bug the FB sweep hit.
        expect(mockDebugToken).toHaveBeenCalledWith('plaintext-token');
    });

    it('stores NULL expiry for a never-expiring token and stays quiet', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        const sets = captureUpdates();
        // debugToken maps Meta's `expires_at: 0` sentinel to undefined.
        mockDebugToken.mockResolvedValue({ isValid: true, expiresAt: undefined, scopes: [], wabaIds: [] });

        const result = await verifyWhatsAppTokens();

        expect(result.dead).toBe(0);
        expect(result.expiringSoon).toBe(0);
        expect(sets[0].whatsappTokenExpiresAt).toBeNull();
        expect(sets.some(destroysCredential)).toBe(false);
    });

    it('does nothing when no number is stale', async () => {
        mockDbSelect.mockReturnValue(stalePages([]));
        captureUpdates();

        expect(await verifyWhatsAppTokens()).toMatchObject({ checked: 0, expiringSoon: 0, dead: 0 });
        expect(mockDebugToken).not.toHaveBeenCalled();
        expect(mockDbUpdate).not.toHaveBeenCalled();
    });
});

describe('verifyWhatsAppTokens — transient failures must not disconnect', () => {
    it('leaves the token intact when Meta returns a 5xx', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        const sets = captureUpdates();
        mockDebugToken.mockRejectedValue(new WhatsAppApiError('Service unavailable', undefined, true));

        const result = await verifyWhatsAppTokens();

        // A bad minute at Meta must never cost a merchant their WhatsApp.
        expect(result.dead).toBe(0);
        expect(sets.some(destroysCredential)).toBe(false);
        expect(mockSendTemplateNotification).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('leaves the token intact when decryption fails (rotated/corrupt key)', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        const sets = captureUpdates();
        mockDecrypt.mockImplementation(() => { throw new Error('bad key'); });

        const result = await verifyWhatsAppTokens();

        // A config/data problem is not an expired token. Clearing here would
        // disconnect every number on every sweep until someone noticed.
        expect(result.dead).toBe(0);
        expect(mockDebugToken).not.toHaveBeenCalled();
        expect(sets.some(destroysCredential)).toBe(false);
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('leaves the token intact on an unrecognised error shape', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        const sets = captureUpdates();
        mockDebugToken.mockRejectedValue(new Error('something odd'));

        expect((await verifyWhatsAppTokens()).dead).toBe(0);
        expect(sets.some(destroysCredential)).toBe(false);
    });
});

describe('verifyWhatsAppTokens — expiring soon', () => {
    it('warns the merchant but does NOT clear a still-working token', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        const sets = captureUpdates();
        mockDebugToken.mockResolvedValue({ isValid: true, expiresAt: inDays(3), scopes: [], wabaIds: [] });

        const result = await verifyWhatsAppTokens();

        expect(result).toMatchObject({ checked: 1, expiringSoon: 1, dead: 0 });
        expect(sets.some(destroysCredential)).toBe(false);
        expect(mockSendTemplateNotification).toHaveBeenCalledTimes(1);
        const [userId, type, variables, data] = mockSendTemplateNotification.mock.calls[0];
        expect(userId).toBe('user-1');
        expect(type).toBe('whatsapp_token_expiring');
        expect(data).toEqual({ action: 'reconnect_whatsapp' });
        // The merchant must be able to act — the number has to reach the copy. The
        // sweep's half of that contract is passing it as `{number}`; that the
        // template actually renders it is asserted against the REAL template in
        // notifications.test.ts ("whatsapp templates render the number").
        expect(variables).toMatchObject({ number: '+966 55 000 0000' });
    });

    it('records the freshly-learned deadline so pre-existing numbers get warned too', async () => {
        // Numbers connected before the expiry column existed have NULL there;
        // the sweep is the only thing that can backfill them.
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        const sets = captureUpdates();
        const deadline = inDays(5);
        mockDebugToken.mockResolvedValue({ isValid: true, expiresAt: deadline, scopes: [], wabaIds: [] });

        await verifyWhatsAppTokens();

        expect(sets[0].whatsappTokenExpiresAt).toEqual(deadline);
    });
});

describe('verifyWhatsAppTokens — dead tokens', () => {
    it('FLAGS the number and preserves the credential', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        const sets = captureUpdates();
        mockDebugToken.mockResolvedValue({ isValid: false, errorMessage: 'Session has expired', scopes: [], wabaIds: [] });

        const result = await verifyWhatsAppTokens();

        expect(result).toMatchObject({ checked: 1, expiringSoon: 0, dead: 1 });
        const set = sets.find(flagsReconnect)!;
        expect(set).toBeDefined();
        expect(set.whatsappDisconnectReason).toBe('token_expired');
        // The credential survives — a false positive must be recoverable without
        // the merchant redoing Embedded Signup (and taking a fresh 60-day clock).
        expect(set).not.toHaveProperty('whatsappAccessToken');
        // The merchant's own auto-reply setting is not ours to flip; the reason
        // column is the gate. Flipping it made "reconnect to start answering
        // again" a promise nothing kept.
        expect(set).not.toHaveProperty('whatsappAutoReplyEnabled');
        // Must advance, or the staleness query re-selects this row every sweep.
        expect(set.whatsappTokenLastVerifiedAt).toBeInstanceOf(Date);
    });

    it('notifies the merchant to reconnect', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        captureUpdates();
        mockDebugToken.mockResolvedValue({ isValid: false, scopes: [], wabaIds: [] });

        await verifyWhatsAppTokens();

        const [userId, type, variables, data] = mockSendTemplateNotification.mock.calls[0];
        expect(userId).toBe('user-1');
        expect(type).toBe('whatsapp_reconnect_needed');
        expect(data).toEqual({ action: 'reconnect_whatsapp' });
        expect(variables).toMatchObject({ number: '+966 55 000 0000' });
    });

    it('treats a 190 from debug_token as OUR app-token fault, not the merchant\'s', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        const sets = captureUpdates();
        mockDebugToken.mockRejectedValue(new WhatsAppApiError('Session has expired', 190, false));

        const result = await verifyWhatsAppTokens();

        // debug_token authenticates with OUR {app-id}|{app-secret}. A wrong or
        // rotated app secret returns 190 about the APP — for every page in the
        // loop. Blaming the merchant would flag the entire estate at once.
        expect(result.checkerFaults).toBe(1);
        expect(result.dead).toBe(0);
        expect(sets.some(flagsReconnect)).toBe(false);
        expect(mockSendTemplateNotification).not.toHaveBeenCalled();
    });

    it('treats an elapsed expiry as dead even when Meta still says is_valid', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        const sets = captureUpdates();
        mockDebugToken.mockResolvedValue({ isValid: true, expiresAt: inDays(-1), scopes: [], wabaIds: [] });

        expect((await verifyWhatsAppTokens()).dead).toBe(1);
        expect(sets.some(flagsReconnect)).toBe(true);
    });

    it('does not throw when the page has no owner to notify', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage({ userId: null })]));
        captureUpdates();
        mockDebugToken.mockResolvedValue({ isValid: false, scopes: [], wabaIds: [] });

        // A workspace page with a detached owner must not crash the whole sweep
        // and strand every number behind it.
        await expect(verifyWhatsAppTokens()).resolves.toBeDefined();
        expect(mockSendTemplateNotification).not.toHaveBeenCalled();
    });
});

describe('verifyWhatsAppTokens — one bad number does not strand the rest', () => {
    it('keeps sweeping after a failure and reports per-number verdicts', async () => {
        mockDbSelect.mockReturnValue(stalePages([
            waPage({ id: 'page-healthy', whatsappAccessToken: 'enc:v1:tok-healthy' }),
            waPage({ id: 'page-broken', whatsappAccessToken: 'enc:v1:tok-broken' }),
            waPage({ id: 'page-dying', whatsappAccessToken: 'enc:v1:tok-dying' }),
        ]));
        const sets = captureUpdates();
        // Keyed on the token, NOT sequential mockResolvedValueOnce: a transient
        // error is retried by withRetry, and sequential mocks would let the retry
        // consume the NEXT page's response — quietly testing the wrong thing.
        mockDebugToken.mockImplementation(async (token: string) => {
            if (token === 'tok-healthy') return { isValid: true, expiresAt: inDays(50), scopes: [], wabaIds: [] };
            if (token === 'tok-dying') return { isValid: true, expiresAt: inDays(2), scopes: [], wabaIds: [] };
            throw new WhatsAppApiError('boom', undefined, true);
        });

        const result = await verifyWhatsAppTokens();

        expect(result.checked).toBe(2);      // the transient failure isn't "checked"
        expect(result.expiringSoon).toBe(1);
        expect(result.dead).toBe(0);
        // The broken one must not take the healthy ones down with it.
        expect(sets.some(destroysCredential)).toBe(false);
    });

    it('retries a transient failure rather than giving up on the number', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        captureUpdates();
        let attempts = 0;
        mockDebugToken.mockImplementation(async () => {
            attempts++;
            if (attempts < 3) throw new WhatsAppApiError('blip', undefined, true);
            return { isValid: true, expiresAt: inDays(40), scopes: [], wabaIds: [] };
        });

        const result = await verifyWhatsAppTokens();

        expect(attempts).toBe(3);
        expect(result.checked).toBe(1);
        expect(result.dead).toBe(0);
    });

    it('does NOT retry a definitive 190 — retrying cannot fix a bad app secret', async () => {
        mockDbSelect.mockReturnValue(stalePages([waPage()]));
        captureUpdates();
        let attempts = 0;
        mockDebugToken.mockImplementation(async () => {
            attempts++;
            throw new WhatsAppApiError('Session has expired', 190, false);
        });

        const result = await verifyWhatsAppTokens();

        expect(attempts).toBe(1);
        expect(result.checkerFaults).toBe(1);
    });
});
