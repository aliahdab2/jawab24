import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A dead page credential must either be re-minted silently, or explained to the
 * merchant by NAME. Both halves shipped as bugs before this file existed:
 *
 *  - 2026-08-10 a password change killed a merchant's page tokens; nothing tried
 *    to re-mint them and nothing told him. ~37h dark, page auto-paused twice.
 *  - 2026-08-14 the same on the owner's own pages; it ended after 14 minutes
 *    only because he happened to re-login while poking at the app.
 *
 * The tests that matter most here are the NEGATIVE ones: this module clears the
 * stored token, so misfiring on a transient blip would take a healthy page dark.
 */

const {
    mockRedisSet, mockRedisDel, mockRedisEval, mockSelect, mockUpdate, mockUpdateSet, mockUpdateWhere,
    mockGetUserPages, mockDecrypt, mockEncrypt,
    mockNotifyWorkspace, mockNotifyUser, mockEmailSend, mockTemplate, mockCaptureError,
} = vi.hoisted(() => ({
    mockRedisSet: vi.fn(),
    mockRedisDel: vi.fn().mockResolvedValue(1),
    mockRedisEval: vi.fn().mockResolvedValue(1),
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(),
    /** The `.set({...})` payload of each UPDATE, so tests can assert WHAT was
     *  written and not merely that something was. */
    mockUpdateSet: vi.fn(),
    /** The `.where(...)` condition of each UPDATE — the CAS guard lives there. */
    mockUpdateWhere: vi.fn(),
    mockGetUserPages: vi.fn(),
    mockDecrypt: vi.fn((t: string) => `decrypted:${t}`),
    mockEncrypt: vi.fn((t: string) => `encrypted:${t}`),
    mockNotifyWorkspace: vi.fn().mockResolvedValue(undefined),
    mockNotifyUser: vi.fn().mockResolvedValue('notif-1'),
    mockEmailSend: vi.fn().mockResolvedValue({ success: true, id: 'email-1' }),
    mockTemplate: vi.fn().mockReturnValue({ subject: 'subj', html: '<html/>' }),
    mockCaptureError: vi.fn(),
}));

vi.mock('../lib/redis', () => ({ redis: { set: mockRedisSet, del: mockRedisDel, eval: mockRedisEval } }));
vi.mock('../db', () => ({ db: { select: mockSelect, update: mockUpdate } }));
vi.mock('../services/facebook', () => ({ facebookService: { getUserPages: mockGetUserPages } }));
vi.mock('../services/facebookCrypto', () => ({ maybeDecryptToken: mockDecrypt, maybeEncryptToken: mockEncrypt }));
vi.mock('../services/notifications', () => ({
    notificationService: { sendNotificationToWorkspace: mockNotifyWorkspace, sendNotification: mockNotifyUser },
}));
vi.mock('../services/email', async () => {
    // The REAL `EmailService`, with only the transport stubbed. `trySend` is the
    // thing under test on this path (a delivered email is what spends the dedup
    // claim), so re-implementing it in the mock would pin my copy instead of the
    // production contract — the drift AI_INSTRUCTIONS §19.3 forbids. Stubbing
    // `send` keeps BOTH of its failure shapes — resolve-false and THROW —
    // flowing through the real `trySend`.
    const actual = await vi.importActual<typeof import('../services/email')>('../services/email');
    const service = new actual.EmailService();
    service.send = mockEmailSend;
    return { ...actual, emailService: service };
});
vi.mock('../utils/emailTemplates', () => ({ pageReconnectEmailTemplate: mockTemplate }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: mockCaptureError }));
vi.mock('../config', () => ({ config: { frontendUrl: 'https://jawab24.com' } }));

import { AxiosError, AxiosHeaders } from 'axios';
import { classifyTokenFailure, clearReconnectAlertClaims, handlePageTokenFailure, markPageNeedsReconnect, withPageTokenRetry, withPageTokenRetryResult } from '../services/pageTokenRecovery';
import { FacebookApiError, DmSendError, classifyDmError } from '../utils/fbGraphErrors';

const PAGE_ID = 'page-uuid-1';
const FB_PAGE_ID = '102140258463931';

/** The exact Graph error that took the owner's two pages down on 2026-08-14. */
function passwordChangedError(): FacebookApiError {
    return new FacebookApiError(
        'Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.',
        { code: 190, subcode: 460, type: 'OAuthException' },
    );
}

/**
 * `db.select()` is called in a fixed cycle per attempt — page row, user row, and
 * (only when alerting) the owner's email row. The cycle REPEATS rather than
 * running out, because a mock that runs dry makes the second attempt fail for
 * the wrong reason: the first draft of the cooldown test passed with the cooldown
 * deleted, since calls 2 and 3 were dying on an exhausted select mock instead.
 */
function selectCycle(...rowSets: unknown[][]) {
    let i = 0;
    mockSelect.mockReset();
    mockSelect.mockImplementation(() => {
        const rows = rowSets[i % rowSets.length];
        i += 1;
        return {
            from: () => ({
                where: () => ({ limit: async () => rows }),
                leftJoin: () => ({ where: () => ({ limit: async () => rows }) }),
            }),
        };
    });
}

const pageRow = (over: Record<string, unknown> = {}) => ({
    id: PAGE_ID, userId: 'user-1', workspaceId: 'ws-1', name: 'الفريق الدمشقي', facebookPageId: FB_PAGE_ID,
    // The ciphertext "read at recovery entry" — both destructive writes CAS on it.
    accessToken: 'enc:stale-page-token', ...over,
});
const userRow = (over: Record<string, unknown> = {}) => ({ facebookAccessToken: 'enc:user-token', ...over });
// Shape of the `getEmailRecipient` projection (services/emailRecipient.ts) —
// this suite mocks `db`, so the row must match what that helper selects.
const ownerRow = { email: 'owner@example.com', name: null, dashboardLanguage: 'ar' };

beforeEach(() => {
    vi.clearAllMocks();
    // A REAL `SET NX` fake, keyed like Redis. Returning a blanket 'OK' would make
    // both the cooldown and the alert-dedup assertions vacuous — the two guards
    // that exist precisely because one dead token produced 36 failing calls.
    //
    // The VALUE is stored, not just the key, because the claims are now tokened
    // (`lib/redisMutex`) and released by compare-and-delete. A fake that ignored
    // the token would let a broken CAS pass.
    const claimedKeys = new Map<string, string>();
    mockRedisSet.mockImplementation(async (key: string, value: string) => {
        if (claimedKeys.has(key)) return null;
        claimedKeys.set(key, value);
        return 'OK';
    });
    // Variadic like real Redis DEL — `clearReconnectAlertClaims` deletes both
    // dedup keys in one call.
    mockRedisDel.mockImplementation(async (...keys: string[]) =>
        keys.reduce((n, k) => n + (claimedKeys.delete(k) ? 1 : 0), 0));
    // `releaseMutex`'s Lua, faithfully: delete ONLY if we still hold the key. A
    // holder whose claim lapsed and was re-taken by someone else deletes nothing.
    mockRedisEval.mockImplementation(async (_script: string, _keyCount: number, key: string, token: string) => {
        if (claimedKeys.get(key) !== token) return 0;
        claimedKeys.delete(key);
        return 1;
    });
    mockDecrypt.mockImplementation((t: string) => `decrypted:${t}`);
    mockEncrypt.mockImplementation((t: string) => `encrypted:${t}`);
    // `.where().returning()` resolving one row = the CAS matched (the common case).
    // Race tests override `mockUpdateWhere` with an empty array.
    mockUpdateWhere.mockReturnValue({ returning: async () => [{ id: PAGE_ID }] });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockEmailSend.mockResolvedValue({ success: true, id: 'email-1' });
    mockTemplate.mockReturnValue({ subject: 'subj', html: '<html/>' });
});

describe('classifyTokenFailure', () => {
    it('names the password change behind 190/460', () => {
        expect(classifyTokenFailure(passwordChangedError())).toBe('password_changed');
    });

    it.each([
        [458, 'logged_out'],
        [459, 'security_checkpoint'],
        [463, 'token_expired'],
    ])('maps 190/%i to %s', (subcode, expected) => {
        expect(classifyTokenFailure(new FacebookApiError('x', { code: 190, subcode }))).toBe(expected);
    });

    it('maps 200/10 to revoked permissions', () => {
        expect(classifyTokenFailure(new FacebookApiError('x', { code: 200, subcode: 10 }))).toBe('permissions_revoked');
    });

    it('keeps an unenumerated 190 subcode as a token failure, not a null', () => {
        // FB only uses 190 for OAuth errors — a new subcode is still our problem.
        expect(classifyTokenFailure(new FacebookApiError('x', { code: 190, subcode: 999 }))).toBe('unknown');
    });

    it('classifies a DmSendError the same way (the send path holds this shape)', () => {
        expect(classifyTokenFailure(new DmSendError('x', { code: 190, subcode: 460 }))).toBe('password_changed');
    });

    it('classifies a bare DmFailure object (commentProcessor holds no Error)', () => {
        expect(classifyTokenFailure({ bucket: 'our_fault', code: 190, subcode: 460 })).toBe('password_changed');
    });

    // ⛔ The negative cases. Each one, misclassified, clears a live token.
    it('returns null for a rate limit', () => {
        expect(classifyTokenFailure(new FacebookApiError('x', { code: 4 }))).toBeNull();
    });

    it('returns null for a transport failure carrying no Graph code', () => {
        expect(classifyTokenFailure(new FacebookApiError('socket hang up', { isTransport: true }))).toBeNull();
    });

    it('returns null for a 190 flagged as transport (5xx from Graph, not a dead token)', () => {
        expect(classifyTokenFailure(new FacebookApiError('x', { code: 190, subcode: 460, isTransport: true }))).toBeNull();
    });

    // ⛔⛔ The same negative case in the shape the COMMENT pipeline actually
    // hands in. The `FacebookApiError` case above cannot cover it: commentProcessor
    // holds a plain `DmFailure`, and until it carried `isTransport` there was no
    // way to say "5xx that happens to quote code 190" in that shape at all — so
    // `toFacebookApiError` rebuilt it as `isTransport: false` and a Facebook
    // OUTAGE classified as every page's credential being revoked at once.
    //
    // Built by running the real `classifyDmError` over a real AxiosError rather
    // than hand-writing the DmFailure: a literal would pin my assumption about
    // that function's output instead of its behaviour (AI_INSTRUCTIONS §19.3).
    it('returns null for a Graph 5xx whose BODY carries code 190 (the DmFailure shape)', () => {
        const outage = new AxiosError('Request failed with status code 500', '500');
        outage.response = {
            status: 500, statusText: 'Internal Server Error', headers: {},
            config: { headers: new AxiosHeaders() },
            data: { error: { message: 'Error validating access token', code: 190, error_subcode: 460, type: 'OAuthException' } },
        };

        const failure = classifyDmError(outage, 'facebook');

        expect(failure.isTransport).toBe(true);
        expect(failure.code).toBe(190);
        expect(classifyTokenFailure(failure)).toBeNull();
    });

    it('still classifies a 4xx 190 from the DmFailure shape as revoked', () => {
        // The counterweight: the guard above must not turn every coded failure
        // into "not a token problem", which would restore the original silence.
        const revoked = new AxiosError('Request failed with status code 400', '400');
        revoked.response = {
            status: 400, statusText: 'Bad Request', headers: {},
            config: { headers: new AxiosHeaders() },
            data: { error: { message: 'Session invalidated', code: 190, error_subcode: 460, type: 'OAuthException' } },
        };

        const failure = classifyDmError(revoked, 'facebook');

        expect(failure.isTransport).toBe(false);
        expect(classifyTokenFailure(failure)).toBe('password_changed');
    });

    it('returns null for a Node system error whose code is a STRING', () => {
        // Pins the OUTCOME, not the mechanism: two independent guards reject this
        // (the numeric-code narrowing, and `isTokenRevoked`'s strict lookup), so
        // weakening either alone does not flip this test. That redundancy is
        // deliberate on a path whose failure mode is clearing a live token.
        const econn = Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' });
        expect(classifyTokenFailure(econn)).toBeNull();
    });

    it('returns null for a plain error and for undefined', () => {
        expect(classifyTokenFailure(new Error('boom'))).toBeNull();
        expect(classifyTokenFailure(undefined)).toBeNull();
    });
});

describe('recovery', () => {
    it('re-mints the page token from /me/accounts and returns it for a retry', async () => {
        selectCycle([pageRow()], [userRow()]);
        mockGetUserPages.mockResolvedValue({ data: [{ id: FB_PAGE_ID, access_token: 'fresh-page-token' }] });

        const token = await handlePageTokenFailure(PAGE_ID, passwordChangedError());

        expect(token).toBe('fresh-page-token');
        expect(mockGetUserPages).toHaveBeenCalledWith('decrypted:enc:user-token');
        expect(mockEncrypt).toHaveBeenCalledWith('fresh-page-token');
        // Nothing to tell the merchant: it healed.
        expect(mockNotifyWorkspace).not.toHaveBeenCalled();
        expect(mockEmailSend).not.toHaveBeenCalled();
        // Cooldown released on success so a later genuine failure heals at once —
        // by COMPARE-AND-DELETE, not a bare DEL. A blind delete would also remove
        // a claim taken by another process after ours lapsed on a slow
        // /me/accounts, stripping the damper from the one caller still using it.
        expect(mockRedisEval).toHaveBeenCalledWith(
            expect.stringContaining('redis.call("del"'),
            1,
            `fb:token:recovery:cooldown:${PAGE_ID}`,
            // The token we were GIVEN, not `expect.any(String)`. A CAS release with
            // the wrong token deletes nothing and reports false — and because
            // `releaseClaim` discards that boolean, an any-string assertion cannot
            // tell a real release from a silent no-op. This is a new failure mode:
            // the previous bare `redis.del` could not fail this way.
            mockRedisSet.mock.calls.find(c => c[0] === `fb:token:recovery:cooldown:${PAGE_ID}`)?.[1],
        );
        // …and the EFFECT. The fake implements the real Lua faithfully, so it
        // answers 1 only when the token MATCHED and the key was actually deleted;
        // a mismatched token answers 0 and deletes nothing. Comparing the resolved
        // value is the difference between "a release was attempted" and "the
        // cooldown is genuinely free for the next failure".
        const evalResults = await Promise.all(mockRedisEval.mock.results.map(r => r.value));
        expect(evalResults).toContain(1);

        // WHAT the success write carries, not merely that it happened: dropping
        // `disconnectReason: null` (what un-flags the page for support triage and
        // the reconnect UI) or `tokenLastVerifiedAt` previously survived 47/47.
        expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
            accessToken: 'encrypted:fresh-page-token',
            disconnectReason: null,
            tokenLastVerifiedAt: expect.any(Date),
        }));

        // A restored token ends the incident: both alert dedup claims must be
        // released so a LATER revocation alerts again (the 190/459 checkpoint
        // resolves on facebook.com with no Jawab24 re-auth — this is the only
        // place that learns the credential came back).
        expect(mockRedisDel).toHaveBeenCalledWith(
            `fb:token:reconnect:alerted:${PAGE_ID}`,
            'fb:token:reconnect:emailed:user-1',
        );
    });

    it('does nothing at all for a non-token error', async () => {
        const token = await handlePageTokenFailure(PAGE_ID, new FacebookApiError('rate limited', { code: 4 }));

        expect(token).toBeNull();
        expect(mockGetUserPages).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('holds the cooldown after a failed attempt, so 36 failing calls make ONE /me/accounts', async () => {
        selectCycle([pageRow()], [userRow()], [ownerRow]);
        mockGetUserPages.mockRejectedValue(new FacebookApiError('dead', { code: 190, subcode: 460 }));

        // Sequential, so the in-flight map is empty each time: the ONLY thing
        // that can stop calls 2 and 3 is the Redis cooldown.
        await handlePageTokenFailure(PAGE_ID, passwordChangedError());
        await handlePageTokenFailure(PAGE_ID, passwordChangedError());
        await handlePageTokenFailure(PAGE_ID, passwordChangedError());

        expect(mockGetUserPages).toHaveBeenCalledTimes(1);
    });

    it('a different page is not damped by another page\'s cooldown', async () => {
        selectCycle([pageRow()], [userRow()], [ownerRow]);
        mockGetUserPages.mockRejectedValue(new FacebookApiError('dead', { code: 190, subcode: 460 }));

        await handlePageTokenFailure(PAGE_ID, passwordChangedError());
        await handlePageTokenFailure('page-uuid-2', passwordChangedError());

        expect(mockGetUserPages).toHaveBeenCalledTimes(2);
    });

    it('collapses concurrent callers into a single in-flight recovery', async () => {
        selectCycle([pageRow()], [userRow()]);
        let release: (v: unknown) => void = () => {};
        mockGetUserPages.mockReturnValue(new Promise(res => { release = res; }));

        const a = handlePageTokenFailure(PAGE_ID, passwordChangedError());
        const b = handlePageTokenFailure(PAGE_ID, passwordChangedError());
        release({ data: [{ id: FB_PAGE_ID, access_token: 'fresh' }] });

        expect(await a).toBe('fresh');
        expect(await b).toBe('fresh');
        expect(mockGetUserPages).toHaveBeenCalledTimes(1);
    });

    it('leaves the token intact when the page is simply absent from /me/accounts', async () => {
        // Business-Portfolio pages legitimately miss this edge — absence is not
        // revocation, and clearing here is the documented disconnect-loop bug.
        selectCycle([pageRow()], [userRow()]);
        mockGetUserPages.mockResolvedValue({ data: [{ id: 'some-other-page', access_token: 'x' }] });

        expect(await handlePageTokenFailure(PAGE_ID, passwordChangedError())).toBeNull();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockNotifyWorkspace).not.toHaveBeenCalled();
    });

    it('leaves the token intact when /me/accounts fails transiently', async () => {
        selectCycle([pageRow()], [userRow()]);
        mockGetUserPages.mockRejectedValue(new FacebookApiError('502', { isTransport: true }));

        expect(await handlePageTokenFailure(PAGE_ID, passwordChangedError())).toBeNull();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('does not clear the token when the USER token cannot be decrypted', async () => {
        // Wrong key / corrupt row is a config problem. Clearing the page token
        // would turn a fixable ops issue into a merchant-facing outage.
        selectCycle([pageRow()], [userRow()]);
        mockDecrypt.mockImplementation(() => { throw new Error('bad key'); });

        expect(await handlePageTokenFailure(PAGE_ID, passwordChangedError())).toBeNull();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockEmailSend).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalled();
    });
});

describe('merchant alert when recovery is impossible', () => {
    beforeEach(() => {
        selectCycle([pageRow()], [userRow()], [ownerRow]);
        mockGetUserPages.mockRejectedValue(new FacebookApiError('gone', { code: 190, subcode: 460 }));
    });

    it('names the password change in the workspace notification', async () => {
        await handlePageTokenFailure(PAGE_ID, passwordChangedError());

        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
        const [workspaceId, payload] = mockNotifyWorkspace.mock.calls[0];
        expect(workspaceId).toBe('ws-1');
        expect(payload.type).toBe('page_disconnected');
        expect(payload.data).toMatchObject({ pageId: PAGE_ID, action: 'reconnect_page', cause: 'password_changed' });
        // The whole point of the feature: the CAUSE, not a generic "reconnect".
        expect(payload.bodies.ar).toContain('تغيير كلمة مرور فيسبوك');
        expect(payload.bodies.en).toContain('password was changed');
    });

    it('emails the page owner with the cause, in their dashboard language', async () => {
        await handlePageTokenFailure(PAGE_ID, passwordChangedError());

        expect(mockTemplate).toHaveBeenCalledWith({
            lang: 'ar',
            pageName: 'الفريق الدمشقي',
            cause: 'password_changed',
            dashboardUrl: 'https://jawab24.com/pages',
        });
        expect(mockEmailSend).toHaveBeenCalledWith(expect.objectContaining({
            to: 'owner@example.com', type: 'page_reconnect', userId: 'user-1',
        }));
    });

    it('clears the stored token so the reconnect UI appears', async () => {
        await handlePageTokenFailure(PAGE_ID, passwordChangedError());

        expect(mockUpdate).toHaveBeenCalled();
        // WHAT was written, not merely that something was: `isConnected` is
        // derived from an empty token, and the reason is what support reads.
        expect(mockUpdateSet).toHaveBeenCalledWith(
            expect.objectContaining({ accessToken: '', disconnectReason: 'token_revoked' }),
        );
    });

    it('alerts once per page per day, however many calls fail', async () => {
        // Driven through markPageNeedsReconnect DIRECTLY, not through two
        // handlePageTokenFailure calls: the recovery cooldown would stop the
        // second one before it ever reached the dedup, and the test would pass
        // while proving nothing about the guard it names.
        selectCycle([ownerRow]);

        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');

        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
        expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });

    it('still sends the email when the in-app notification throws', async () => {
        mockNotifyWorkspace.mockRejectedValue(new Error('notifications table down'));

        await handlePageTokenFailure(PAGE_ID, passwordChangedError());

        expect(mockEmailSend).toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalled();
    });

    // ── The dedup key must gate the NOTIFICATION and nothing else ──────────
    //
    // This is the defect the module exists to remove, re-entering through its
    // own fix. The alert claim used to be taken BEFORE the row was written, so a
    // page whose token died a second time inside 24h returned at the claim and
    // kept a POPULATED access_token with a NULL disconnect_reason: a
    // healthy-looking row with a dead token, no reconnect UI, no email — exactly
    // the 2026-08-10 / 2026-08-14 signature.
    //
    // Mutation-checked: moving the `db.update` back below the claim fails the
    // first test; making the write conditional on the claim fails both.
    it('writes the dead-token state on EVERY confirmation, even when the alert is deduped', async () => {
        selectCycle([ownerRow]);

        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');

        // The row is the system's answer to "is this credential dead?" and must
        // be re-stated every time Facebook confirms it — the merchant may have
        // reconnected in between (controllers/pages.ts restores the token and
        // nulls the reason, and deletes no Redis key).
        expect(mockUpdate).toHaveBeenCalledTimes(3);
        // The mailbox is a different question, and stays deduped.
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
        expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });

    it('records the disconnect even when the alert claim was burned by an earlier incident', async () => {
        selectCycle([ownerRow]);

        // Incident 1 — alerted, claim taken for 24h.
        await markPageNeedsReconnect(pageRow() as never, 'permissions_revoked');
        mockUpdate.mockClear();
        mockUpdateSet.mockClear();

        // Merchant reconnects (not modelled — nothing deletes the Redis key), then
        // changes their Facebook password hours later, still inside the 24h window.
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        // Whatever else is suppressed, `isConnected` must go false.
        expect(mockUpdateSet).toHaveBeenCalledWith(
            expect.objectContaining({ accessToken: '', disconnectReason: 'token_revoked' }),
        );
    });
});

// ── The email claim must be GIVEN BACK when no email went out ─────────────
//
// Holding a 24h per-owner claim for a send that failed costs the merchant the
// one channel that reaches them when they are not in the app — over a failure
// that was ours. `pageAutoPause.notifyMerchantAutoPaused` already learned this
// (its `finally` release); the clone here did not inherit it.
//
// Mutation-checked: deleting either `releaseClaim()` call fails the matching
// test, and deleting both fails all three.
describe('reconnect email — a claim that did not send is released', () => {
    beforeEach(() => {
        selectCycle([ownerRow]);
    });

    it('lets a sibling page retry after the provider rejects the send', async () => {
        mockEmailSend.mockResolvedValueOnce({ success: false, error: 'Resend 422' });

        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        await markPageNeedsReconnect(pageRow({ id: 'page-uuid-2' }) as never, 'password_changed');

        // Two attempts: the first burned nothing, because it delivered nothing.
        expect(mockEmailSend).toHaveBeenCalledTimes(2);
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('lets a sibling page retry after the send THROWS (network, not a rejection)', async () => {
        mockEmailSend.mockRejectedValueOnce(new Error('ECONNRESET'));

        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        await markPageNeedsReconnect(pageRow({ id: 'page-uuid-2' }) as never, 'password_changed');

        expect(mockEmailSend).toHaveBeenCalledTimes(2);
    });

    it('releases the claim when the owner has no email on file', async () => {
        // No address → nothing sent → nothing to dedup. Burning the day here
        // would silence the owner over a row they can fix in the app.
        selectCycle([]);
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        expect(mockEmailSend).not.toHaveBeenCalled();

        selectCycle([ownerRow]);
        await markPageNeedsReconnect(pageRow({ id: 'page-uuid-2' }) as never, 'password_changed');
        expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });

    it('still collapses the fan-out when the send SUCCEEDS', async () => {
        // The release must not become "no dedup at all" — the guard that stops
        // nine identical emails to one agency owner still has to hold.
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        await markPageNeedsReconnect(pageRow({ id: 'page-uuid-2' }) as never, 'password_changed');
        await markPageNeedsReconnect(pageRow({ id: 'page-uuid-3' }) as never, 'password_changed');

        expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });
});

describe('withPageTokenRetry', () => {
    it('retries the call exactly once with the fresh token', async () => {
        selectCycle([pageRow()], [userRow()]);
        mockGetUserPages.mockResolvedValue({ data: [{ id: FB_PAGE_ID, access_token: 'fresh' }] });

        const call = vi.fn()
            .mockRejectedValueOnce(passwordChangedError())
            .mockResolvedValueOnce('ok');

        await expect(withPageTokenRetry({ id: PAGE_ID, accessToken: 'stale' }, call)).resolves.toBe('ok');
        expect(call).toHaveBeenNthCalledWith(1, 'stale');
        expect(call).toHaveBeenNthCalledWith(2, 'fresh');
        expect(call).toHaveBeenCalledTimes(2);
    });

    it('rethrows the ORIGINAL error when recovery is impossible — no silent empty result', async () => {
        selectCycle([pageRow()], [userRow()], [ownerRow]);
        mockGetUserPages.mockRejectedValue(new FacebookApiError('gone', { code: 190, subcode: 460 }));
        const original = passwordChangedError();

        await expect(
            withPageTokenRetry({ id: PAGE_ID, accessToken: 'stale' }, vi.fn().mockRejectedValue(original)),
        ).rejects.toBe(original);
    });

    it('does not retry a non-token failure', async () => {
        const call = vi.fn().mockRejectedValue(new FacebookApiError('rate limited', { code: 4 }));

        await expect(withPageTokenRetry({ id: PAGE_ID, accessToken: 'stale' }, call)).rejects.toThrow('rate limited');
        expect(call).toHaveBeenCalledTimes(1);
    });
});

/**
 * The unit of the CAUSE is the user, not the page: one revoked Facebook session
 * kills every page token minted from it in the same instant. A page-scoped dedup
 * therefore reads as "deduped" while mailing an agency owner one identical notice
 * per page — the exact fan-out this module's own docblock argues against for
 * `tokenRefresh.notifyReconnectNeeded`.
 */
// ── The result-shaped retry the COMMENT path needs ────────────────────────
//
// The comment adapters return `{ success: false, dmFailure }` instead of
// throwing, so `withPageTokenRetry` never fires there. Without this, the comment
// that EXPOSED the dead token is flagged `dm_failed` and never answered while
// the background re-mint helps only the NEXT customer — on the very surface the
// 2026-08-14 report came from (an empty Post Reply picker).
describe('withPageTokenRetryResult', () => {
    /** The comment adapters' result shape, narrowed to what this reads. */
    type SendResult = { success: boolean; dmFailure?: { bucket: string; code: number; subcode?: number; rawMessage: string } };
    const sendOf = () => vi.fn<(accessToken: string) => Promise<SendResult>>();
    const failureOf = (r: SendResult) => (r.success ? undefined : r.dmFailure);

    const ok: SendResult = { success: true, dmFailure: undefined };
    const dead: SendResult = { success: false, dmFailure: { bucket: 'our_fault', code: 190, subcode: 460, rawMessage: 'gone' } };

    beforeEach(() => {
        selectCycle([pageRow()], [userRow()]);
        mockGetUserPages.mockResolvedValue({ data: [{ id: FB_PAGE_ID, access_token: 'fresh-page-token' }] });
    });

    it('re-mints and retries once, and REPORTS the fresh token for adoption', async () => {
        const call = sendOf()
            .mockResolvedValueOnce(dead)
            .mockResolvedValueOnce(ok);

        const { result, accessToken } = await withPageTokenRetryResult(PAGE_ID, 'stale-token', call, failureOf);

        expect(call).toHaveBeenCalledTimes(2);
        expect(call).toHaveBeenNthCalledWith(1, 'stale-token');
        expect(call).toHaveBeenNthCalledWith(2, 'fresh-page-token');
        expect(result).toBe(ok);
        // Returned, not just used: the caller's `likeComment` runs on this same
        // credential afterwards and would otherwise re-use the dead one.
        expect(accessToken).toBe('fresh-page-token');
    });

    it('does not call again on success — one send stays one send', async () => {
        const call = sendOf().mockResolvedValue(ok);

        const { accessToken } = await withPageTokenRetryResult(PAGE_ID, 'good-token', call, failureOf);

        expect(call).toHaveBeenCalledTimes(1);
        expect(accessToken).toBe('good-token');
        expect(mockGetUserPages).not.toHaveBeenCalled();
    });

    it('treats a NULL failure as success — one call, original result, no re-mint', async () => {
        // Pins the CONTRACT: `failureOf` may say "nothing wrong" with either
        // `undefined` or `null`, and both mean the send stands as-is.
        //
        // ⚠️ It does NOT pin the `|| failure === null` half of the guard, and no
        // test can: dropping it lets `null` reach `handlePageTokenFailure`, which
        // classifies it to `null` and returns before touching Redis or Graph — so
        // the result, the token, the call count and `getUserPages` are all
        // identical either way. Verified by mutation: removing that half leaves
        // the suite green. It is a true equivalent mutation, and the guard earns
        // its place by making the contract legible, not by changing behaviour.
        // Claiming otherwise here would be the vacuous-assertion trap this file
        // exists to avoid.
        const call = sendOf().mockResolvedValue(ok);

        const { result, accessToken } = await withPageTokenRetryResult(PAGE_ID, 'good-token', call, () => null);

        expect(call).toHaveBeenCalledTimes(1);
        expect(result).toBe(ok);
        expect(accessToken).toBe('good-token');
        expect(mockGetUserPages).not.toHaveBeenCalled();
    });

    it('does not retry a failure that is not a dead credential', async () => {
        // A blocked customer is not a token problem; retrying it would send the
        // same doomed request twice and double the Graph cost of every refusal.
        const refused: SendResult = { success: false, dmFailure: { bucket: 'customer_refused', code: 551, rawMessage: 'unavailable' } };
        const call = sendOf().mockResolvedValue(refused);

        const { result, accessToken } = await withPageTokenRetryResult(PAGE_ID, 'good-token', call, failureOf);

        expect(call).toHaveBeenCalledTimes(1);
        expect(result).toBe(refused);
        expect(accessToken).toBe('good-token');
    });

    it('returns the ORIGINAL failure when recovery is impossible — never a fake success', async () => {
        selectCycle([pageRow()], [userRow()], [ownerRow]);
        mockGetUserPages.mockRejectedValue(new FacebookApiError('gone', { code: 190, subcode: 460 }));
        const call = sendOf().mockResolvedValue(dead);

        const { result, accessToken } = await withPageTokenRetryResult(PAGE_ID, 'stale-token', call, failureOf);

        expect(call).toHaveBeenCalledTimes(1);
        expect(result).toBe(dead);
        expect(accessToken).toBe('stale-token');
        // …and the merchant was told, since nothing else can fix it.
        expect(mockNotifyWorkspace).toHaveBeenCalled();
    });
});

describe('alert fan-out across an owner\'s pages', () => {
    beforeEach(() => {
        selectCycle([ownerRow]);
    });

    it('mails the owner ONCE when several of their pages die together', async () => {
        await markPageNeedsReconnect(pageRow({ id: 'page-a' }) as never, 'password_changed');
        await markPageNeedsReconnect(pageRow({ id: 'page-b' }) as never, 'password_changed');
        await markPageNeedsReconnect(pageRow({ id: 'page-c' }) as never, 'password_changed');

        expect(mockEmailSend).toHaveBeenCalledTimes(1);
        // The in-app card stays PER PAGE on purpose: each carries its own pageId
        // and its own reconnect action, so three cards are three things to fix
        // rather than three copies of one thing. Only the mailbox collapses.
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(3);
        // Every page is still marked disconnected — suppressing the email must
        // never suppress the state the reconnect UI reads.
        expect(mockUpdate).toHaveBeenCalledTimes(3);
    });

    it('still mails each owner when the dead pages belong to DIFFERENT users', async () => {
        // The negative control: collapsing on the wrong key would silence a second
        // merchant entirely, which is worse than the fan-out it fixes.
        await markPageNeedsReconnect(pageRow({ id: 'page-a', userId: 'user-1' }) as never, 'password_changed');
        await markPageNeedsReconnect(pageRow({ id: 'page-b', userId: 'user-2' }) as never, 'password_changed');

        expect(mockEmailSend).toHaveBeenCalledTimes(2);
    });
});

/**
 * Both Redis guards fail OPEN, and each is right to on its own. Failing open on
 * BOTH at once restores the storm they exist to stop: the 2026-08-14 window was
 * 36 failing Graph calls in 11 minutes, arriving SEQUENTIALLY — so the in-process
 * single-flight, which only collapses concurrent callers, damps none of them.
 */
describe('Redis outage', () => {
    // Ids used nowhere else in this file. The fallback ledger is module state that
    // outlives a test and holds its claims for the real TTL, so a shared id would
    // make whichever of these ran second assert against the first one's claims.
    // Only these cases ever reach it — every other test has a working Redis fake.
    const DOWN_PAGE = 'page-redis-down';

    beforeEach(() => {
        selectCycle([pageRow({ id: DOWN_PAGE, userId: 'user-redis-down' })], [userRow()], [ownerRow]);
        mockRedisSet.mockRejectedValue(new Error('redis unreachable'));
        mockGetUserPages.mockRejectedValue(new FacebookApiError('gone', { code: 190, subcode: 460 }));
    });

    it('caps a burst at one /me/accounts and one alert, without going silent', async () => {
        for (let i = 0; i < 6; i += 1) {
            await handlePageTokenFailure(DOWN_PAGE, passwordChangedError());
        }

        // Exactly 1 is the whole assertion: 6 would be the storm the guards exist
        // to stop, and 0 would be the silence they must never cause — fail-open is
        // deliberate, because a suppressed reconnect notice costs the merchant
        // every customer who writes while the page is dead.
        expect(mockGetUserPages).toHaveBeenCalledTimes(1);
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
        expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });

    // The two cases below drive `markPageNeedsReconnect` DIRECTLY, because the
    // cooldown fallback stops calls 2..n of the burst above long before they reach
    // either alert guard — so the burst test passes with EITHER of them deleted and
    // proves nothing about them. One case per guard, each failing on its own.
    it('holds the per-page alert dedup with Redis down (same page, repeatedly)', async () => {
        selectCycle([ownerRow]);
        const page = pageRow({ id: 'rd-page-repeat', userId: 'user-rd-repeat' });

        await markPageNeedsReconnect(page as never, 'password_changed');
        await markPageNeedsReconnect(page as never, 'password_changed');
        await markPageNeedsReconnect(page as never, 'password_changed');

        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
    });

    it('holds the per-OWNER email dedup with Redis down (distinct pages, one owner)', async () => {
        selectCycle([ownerRow]);
        const userId = 'user-rd-fanout';

        await markPageNeedsReconnect(pageRow({ id: 'rd-page-a', userId }) as never, 'password_changed');
        await markPageNeedsReconnect(pageRow({ id: 'rd-page-b', userId }) as never, 'password_changed');
        await markPageNeedsReconnect(pageRow({ id: 'rd-page-c', userId }) as never, 'password_changed');

        // Three distinct pages → three distinct alert keys → three cards, by design.
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(3);
        // …and still ONE email. The owner-scoped claim is the only thing standing
        // between an agency owner and one notice per dead page; it has to survive
        // the outage too, not just the happy path.
        expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });
});

describe('clearReconnectAlertClaims — reconnect must re-arm every channel', () => {
    // The 24h dedup collapses repeats of ONE incident. Without a release on
    // reconnect, a page that dies again inside the window alerts on NO channel:
    // the card/push return at the alert claim, the email at the owner claim, the
    // auto-pause counter never advances (webhooks skip a cleared page), and the
    // 6h sweep excludes `access_token = ''` rows. This is the exact silence the
    // module exists to end, reproduced by its own dedup.
    it('revoke → alert → reconnect → revoke again inside 24h → alerts again on BOTH channels', async () => {
        selectCycle([ownerRow]);

        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
        expect(mockEmailSend).toHaveBeenCalledTimes(1);

        // Same incident, repeat failure: suppressed — that is what the claims are for.
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
        expect(mockEmailSend).toHaveBeenCalledTimes(1);

        // The merchant reconnects (controllers/pages.ts calls this on the token write).
        clearReconnectAlertClaims(PAGE_ID, 'user-1');

        // NEW incident inside the original 24h window: every channel must fire.
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(2);
        expect(mockEmailSend).toHaveBeenCalledTimes(2);
    });

    it('releases the per-process fallback ledger too (Redis down for the whole cycle)', async () => {
        selectCycle([ownerRow]);
        mockRedisSet.mockRejectedValue(new Error('redis down'));

        const page = pageRow({ id: 'relcl-page', userId: 'relcl-user' });
        await markPageNeedsReconnect(page as never, 'password_changed');
        await markPageNeedsReconnect(page as never, 'password_changed');
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);

        clearReconnectAlertClaims('relcl-page', 'relcl-user');

        await markPageNeedsReconnect(page as never, 'password_changed');
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(2);
    });
});

describe('the CAS guard on the two destructive writes', () => {
    /** Column names referenced by a drizzle condition — walks the SQL chunk tree.
     *  Pins that the WHERE actually carries the CAS (`access_token`), which the
     *  0-row tests below cannot: the mock returns whatever it is told regardless
     *  of the condition's content. */
    const columnNames = (cond: unknown): string[] => {
        const out: string[] = [];
        const walk = (c: unknown): void => {
            if (!c || typeof c !== 'object') return;
            const chunks = (c as { queryChunks?: unknown[] }).queryChunks;
            if (Array.isArray(chunks)) chunks.forEach(walk);
            const maybe = c as { name?: unknown; columnType?: unknown };
            if (typeof maybe.name === 'string' && maybe.columnType) out.push(maybe.name);
        };
        walk(cond);
        return out;
    };

    it('both writes compare-and-set on the token read at entry, not just the page id', async () => {
        selectCycle([ownerRow]);
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        expect(columnNames(mockUpdateWhere.mock.calls[0][0])).toEqual(expect.arrayContaining(['id', 'access_token']));

        vi.clearAllMocks();
        mockUpdateWhere.mockReturnValue({ returning: async () => [{ id: PAGE_ID }] });
        mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
        mockUpdate.mockReturnValue({ set: mockUpdateSet });
        selectCycle([pageRow()], [userRow()]);
        mockGetUserPages.mockResolvedValue({ data: [{ id: FB_PAGE_ID, access_token: 'fresh-page-token' }] });
        await handlePageTokenFailure(PAGE_ID, passwordChangedError());
        expect(columnNames(mockUpdateWhere.mock.calls[0][0])).toEqual(expect.arrayContaining(['id', 'access_token']));
    });

    it('does not alert — and does not burn the 24h claim — when a reconnect won the race', async () => {
        selectCycle([ownerRow]);
        // Zero rows back = the row no longer holds the token this verdict was
        // formed on (the merchant reconnected during /me/accounts).
        mockUpdateWhere.mockReturnValue({ returning: async () => [] });

        await markPageNeedsReconnect(pageRow() as never, 'password_changed');

        expect(mockNotifyWorkspace).not.toHaveBeenCalled();
        expect(mockEmailSend).not.toHaveBeenCalled();
        // The claim was NOT consumed by the aborted attempt: a genuine disconnect
        // right after must still alert.
        mockUpdateWhere.mockReturnValue({ returning: async () => [{ id: PAGE_ID }] });
        await markPageNeedsReconnect(pageRow() as never, 'password_changed');
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
        expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });

    it('re-mint that loses the race still hands the caller a working token, but leaves the row and the claims alone', async () => {
        selectCycle([pageRow()], [userRow()]);
        mockGetUserPages.mockResolvedValue({ data: [{ id: FB_PAGE_ID, access_token: 'fresh-page-token' }] });
        mockUpdateWhere.mockReturnValue({ returning: async () => [] });

        const token = await handlePageTokenFailure(PAGE_ID, passwordChangedError());

        // Our minted token is valid — the caller's retry should still use it.
        expect(token).toBe('fresh-page-token');
        // But the row belongs to whoever won, and their write path owns the
        // claim release: no DEL from this side.
        expect(mockRedisDel).not.toHaveBeenCalled();
        expect(mockNotifyWorkspace).not.toHaveBeenCalled();
    });
});
