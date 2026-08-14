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
    mockRedisSet, mockRedisDel, mockSelect, mockUpdate,
    mockGetUserPages, mockDecrypt, mockEncrypt,
    mockNotifyWorkspace, mockNotifyUser, mockEmailSend, mockTemplate, mockCaptureError,
} = vi.hoisted(() => ({
    mockRedisSet: vi.fn(),
    mockRedisDel: vi.fn().mockResolvedValue(1),
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(),
    mockGetUserPages: vi.fn(),
    mockDecrypt: vi.fn((t: string) => `decrypted:${t}`),
    mockEncrypt: vi.fn((t: string) => `encrypted:${t}`),
    mockNotifyWorkspace: vi.fn().mockResolvedValue(undefined),
    mockNotifyUser: vi.fn().mockResolvedValue('notif-1'),
    mockEmailSend: vi.fn().mockResolvedValue({ success: true, id: 'email-1' }),
    mockTemplate: vi.fn().mockReturnValue({ subject: 'subj', html: '<html/>' }),
    mockCaptureError: vi.fn(),
}));

vi.mock('../lib/redis', () => ({ redis: { set: mockRedisSet, del: mockRedisDel } }));
vi.mock('../db', () => ({ db: { select: mockSelect, update: mockUpdate } }));
vi.mock('../services/facebook', () => ({ facebookService: { getUserPages: mockGetUserPages } }));
vi.mock('../services/facebookCrypto', () => ({ maybeDecryptToken: mockDecrypt, maybeEncryptToken: mockEncrypt }));
vi.mock('../services/notifications', () => ({
    notificationService: { sendNotificationToWorkspace: mockNotifyWorkspace, sendNotification: mockNotifyUser },
}));
vi.mock('../services/email', () => ({ emailService: { send: mockEmailSend } }));
vi.mock('../utils/emailTemplates', () => ({ pageReconnectEmailTemplate: mockTemplate }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: mockCaptureError }));
vi.mock('../config', () => ({ config: { frontendUrl: 'https://jawab24.com' } }));

import { classifyTokenFailure, handlePageTokenFailure, markPageNeedsReconnect, withPageTokenRetry } from '../services/pageTokenRecovery';
import { FacebookApiError, DmSendError } from '../utils/fbGraphErrors';

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
    id: PAGE_ID, userId: 'user-1', workspaceId: 'ws-1', name: 'الفريق الدمشقي', facebookPageId: FB_PAGE_ID, ...over,
});
const userRow = (over: Record<string, unknown> = {}) => ({ facebookAccessToken: 'enc:user-token', ...over });
const ownerRow = { ownerEmail: 'owner@example.com', dashboardLanguage: 'ar' };

beforeEach(() => {
    vi.clearAllMocks();
    // A REAL `SET NX` fake, keyed like Redis. Returning a blanket 'OK' would make
    // both the cooldown and the alert-dedup assertions vacuous — the two guards
    // that exist precisely because one dead token produced 36 failing calls.
    const claimedKeys = new Set<string>();
    mockRedisSet.mockImplementation(async (key: string) => {
        if (claimedKeys.has(key)) return null;
        claimedKeys.add(key);
        return 'OK';
    });
    mockRedisDel.mockImplementation(async (key: string) => { claimedKeys.delete(key); return 1; });
    mockDecrypt.mockImplementation((t: string) => `decrypted:${t}`);
    mockEncrypt.mockImplementation((t: string) => `encrypted:${t}`);
    mockUpdate.mockReturnValue({ set: () => ({ where: async () => undefined }) });
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
        // Cooldown released on success so a later genuine failure heals at once.
        expect(mockRedisDel).toHaveBeenCalledWith(`fb:token:recovery:cooldown:${PAGE_ID}`);
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
