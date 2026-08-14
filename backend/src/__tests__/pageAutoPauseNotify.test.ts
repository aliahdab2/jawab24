import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The auto-pause crossing must TELL the merchant (in-app + push + email) —
 * a paused page answers nobody, and the dashboard banner alone left a real
 * merchant dark through two pause cycles in one evening (2026-08-10).
 */

const {
    mockIncr, mockExpire, mockDel, mockSet, mockCaptureError,
    mockUpdate, mockSelect, mockLogToggle,
    mockNotifyWorkspace, mockNotifyUser, mockEmailSend, mockTemplate,
    mockHandleTokenFailure,
} = vi.hoisted(() => ({
    mockHandleTokenFailure: vi.fn().mockResolvedValue(null),
    mockIncr: vi.fn(),
    mockExpire: vi.fn().mockResolvedValue(1),
    mockDel: vi.fn().mockResolvedValue(1),
    mockSet: vi.fn(),
    mockCaptureError: vi.fn(),
    mockUpdate: vi.fn(),
    mockSelect: vi.fn(),
    mockLogToggle: vi.fn(),
    mockNotifyWorkspace: vi.fn().mockResolvedValue(undefined),
    mockNotifyUser: vi.fn().mockResolvedValue('notif-1'),
    mockEmailSend: vi.fn().mockResolvedValue({ success: true, id: 'email-1' }),
    mockTemplate: vi.fn().mockReturnValue({ subject: 'subj', html: '<html/>' }),
}));

vi.mock('../lib/redis', () => ({ redis: { incr: mockIncr, expire: mockExpire, del: mockDel, set: mockSet } }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: mockCaptureError }));
vi.mock('../db', () => ({ db: { update: mockUpdate, select: mockSelect } }));
vi.mock('../services/auditLog', () => ({ logAutoReplyToggle: mockLogToggle }));
vi.mock('../services/notifications', () => ({
    notificationService: {
        sendTemplateNotificationToWorkspace: mockNotifyWorkspace,
        sendTemplateNotification: mockNotifyUser,
    },
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
vi.mock('../utils/emailTemplates', () => ({ autoPausedEmailTemplate: mockTemplate }));
vi.mock('../config', () => ({ config: { frontendUrl: 'https://jawab24.com' } }));
// Collaborator, not a dependency of the pause logic: recordSendFailure hands it
// the raw failure so a revoked credential is re-minted on the FIRST rejection
// instead of the tenth. Mocked here so this file keeps testing the counter.
vi.mock('../services/pageTokenRecovery', () => ({ handlePageTokenFailure: mockHandleTokenFailure }));

import { recordSendFailure, PAUSE_THRESHOLD, isNotifiableAutoPausePlatform } from '../services/pageAutoPause';

const PAGE = 'page-1';
const flush = () => new Promise((r) => setImmediate(r));

function mockPauseRow(overrides: Partial<{ consecutiveSendFailures: number; autoReplyDisabledReason: string | null; userId: string | null; workspaceId: string | null }> = {}) {
    const row = {
        id: PAGE,
        userId: 'user-1',
        workspaceId: 'ws-1',
        consecutiveSendFailures: PAUSE_THRESHOLD,
        autoReplyDisabledReason: 'auto_pause',
        ...overrides,
    };
    mockUpdate.mockReturnValue({
        set: () => ({ where: () => ({ returning: async () => [row] }) }),
    });
}

function mockOwnerInfo(info: { pageName?: string | null; ownerEmail?: string | null; dashboardLanguage?: string | null } = {}) {
    const row = { pageName: 'My Page', ownerEmail: 'owner@example.com', dashboardLanguage: 'ar', ...info };
    mockSelect.mockReturnValue({
        from: () => ({
            leftJoin: () => ({
                leftJoin: () => ({
                    where: () => ({ limit: async () => [row] }),
                }),
            }),
        }),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mockExpire.mockResolvedValue(1);
    mockDel.mockResolvedValue(1);
    mockSet.mockResolvedValue('OK');
    mockNotifyWorkspace.mockResolvedValue(undefined);
    mockNotifyUser.mockResolvedValue('notif-1');
    mockEmailSend.mockResolvedValue({ success: true, id: 'email-1' });
    mockTemplate.mockReturnValue({ subject: 'subj', html: '<html/>' });
    mockOwnerInfo();
});

describe('auto-pause merchant notification', () => {
    it('crossing the threshold notifies the workspace and emails the page owner', async () => {
        mockPauseRow();
        await recordSendFailure(PAGE, 'our_fault', 'facebook');
        await flush();

        expect(mockNotifyWorkspace).toHaveBeenCalledWith(
            'ws-1',
            'auto_reply_paused',
            { pageName: 'My Page' },
            { pageId: PAGE, action: 'reconnect_page', urgent: true },
        );
        expect(mockSet).toHaveBeenCalledWith(`notif:auto_pause_email:${PAGE}`, '1', 'EX', 24 * 60 * 60, 'NX');
        expect(mockTemplate).toHaveBeenCalledWith({
            lang: 'ar',
            pageName: 'My Page',
            dashboardUrl: 'https://jawab24.com/dashboard',
        });
        expect(mockEmailSend).toHaveBeenCalledWith(expect.objectContaining({
            to: 'owner@example.com',
            type: 'auto_pause',
            userId: 'user-1',
        }));
    });

    it('forwards the raw failure to token recovery on the FIRST rejection, long before the threshold', async () => {
        mockPauseRow({ consecutiveSendFailures: 1, autoReplyDisabledReason: null });
        const failure = { bucket: 'our_fault', code: 190, subcode: 460 };
        await recordSendFailure(PAGE, 'our_fault', 'facebook', failure);
        await flush();

        expect(mockHandleTokenFailure).toHaveBeenCalledWith(PAGE, failure);
        // …and the counter still ran: recovery does not excuse the failure.
        expect(mockUpdate).toHaveBeenCalled();
    });

    it('does not call token recovery when the caller passes no failure (old 3-arg callers)', async () => {
        mockPauseRow({ consecutiveSendFailures: 1, autoReplyDisabledReason: null });
        await recordSendFailure(PAGE, 'our_fault', 'facebook');
        await flush();

        expect(mockHandleTokenFailure).not.toHaveBeenCalled();
    });

    // ⛔ Cross-channel credential confusion. WhatsApp sits on the same page row but
    // holds `whatsapp_access_token`, and Meta answers an EXPIRED WABA token with the
    // same code 190 as a revoked page token. Without the gate, a WhatsApp expiry runs
    // Facebook page-token recovery — which, when the user session is also gone, clears
    // `pages.access_token` and mails the merchant "reconnect your Facebook page" to
    // explain a WhatsApp outage. WhatsApp has its own cron and its own notice.
    it('does NOT run Facebook token recovery for a WhatsApp failure, 190 or not', async () => {
        mockPauseRow({ consecutiveSendFailures: 1, autoReplyDisabledReason: null });
        await recordSendFailure(PAGE, 'our_fault', 'whatsapp', { bucket: 'our_fault', code: 190, subcode: 463 });
        await flush();

        expect(mockHandleTokenFailure).not.toHaveBeenCalled();
        // The page-level counter still ran — the send DID fail, whatever the credential.
        expect(mockUpdate).toHaveBeenCalled();
    });

    it('runs recovery for instagram — it rides the SAME facebook page token', async () => {
        mockPauseRow({ consecutiveSendFailures: 1, autoReplyDisabledReason: null });
        const failure = { bucket: 'our_fault', code: 190, subcode: 460 };
        await recordSendFailure(PAGE, 'our_fault', 'instagram', failure);
        await flush();

        expect(mockHandleTokenFailure).toHaveBeenCalledWith(PAGE, failure);
    });

    it('runs recovery when the platform is omitted — that is the comment pipeline, Meta-only', async () => {
        mockPauseRow({ consecutiveSendFailures: 1, autoReplyDisabledReason: null });
        const failure = { bucket: 'our_fault', code: 190, subcode: 460 };
        await recordSendFailure(PAGE, 'our_fault', undefined, failure);
        await flush();

        expect(mockHandleTokenFailure).toHaveBeenCalledWith(PAGE, failure);
    });

    it('below the threshold sends nothing', async () => {
        mockPauseRow({ consecutiveSendFailures: PAUSE_THRESHOLD - 1, autoReplyDisabledReason: null });
        await recordSendFailure(PAGE, 'our_fault');
        await flush();

        expect(mockNotifyWorkspace).not.toHaveBeenCalled();
        expect(mockNotifyUser).not.toHaveBeenCalled();
        expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('a page already disabled for another reason does not notify (crossing guard)', async () => {
        mockPauseRow({ autoReplyDisabledReason: 'user' });
        await recordSendFailure(PAGE, 'our_fault');
        await flush();

        expect(mockNotifyWorkspace).not.toHaveBeenCalled();
        expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('falls back to the owner notification when the page has no workspace', async () => {
        mockPauseRow({ workspaceId: null });
        await recordSendFailure(PAGE, 'our_fault');
        await flush();

        expect(mockNotifyWorkspace).not.toHaveBeenCalled();
        expect(mockNotifyUser).toHaveBeenCalledWith(
            'user-1',
            'auto_reply_paused',
            { pageName: 'My Page' },
            { pageId: PAGE, action: 'reconnect_page', urgent: true },
        );
    });

    it('dedupes the email across pause cycles but still sends the notification', async () => {
        mockPauseRow();
        mockSet.mockResolvedValue(null); // key already existed → within the 24h window
        await recordSendFailure(PAGE, 'our_fault');
        await flush();

        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
        expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('skips the email (not the notification) when the owner has no email address', async () => {
        mockPauseRow();
        mockOwnerInfo({ ownerEmail: null });
        await recordSendFailure(PAGE, 'our_fault');
        await flush();

        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('uses English when the owner dashboard language is en', async () => {
        mockPauseRow();
        mockOwnerInfo({ dashboardLanguage: 'en' });
        await recordSendFailure(PAGE, 'our_fault');
        await flush();

        expect(mockTemplate).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en' }));
    });

    it('releases the dedup key and reports when the email provider fails', async () => {
        mockPauseRow();
        // emailService.send RESOLVES with success:false — it does not throw.
        mockEmailSend.mockResolvedValue({ success: false, error: 'Resend 503' });
        await recordSendFailure(PAGE, 'our_fault');
        await flush();

        expect(mockDel).toHaveBeenCalledWith(`notif:auto_pause_email:${PAGE}`);
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.any(Error),
            'pageAutoPause.autoPauseEmailFailed',
            expect.objectContaining({ extra: { pageId: PAGE, userId: 'user-1' } }),
        );
    });

    it('still emails when Redis is unavailable (fail-open on the dedup)', async () => {
        mockPauseRow();
        mockSet.mockRejectedValue(new Error('redis down'));
        await recordSendFailure(PAGE, 'our_fault');
        await flush();

        expect(mockEmailSend).toHaveBeenCalledTimes(1);
        // Nothing to release — the key was never claimed.
        expect(mockDel).not.toHaveBeenCalled();
    });

    it('a notification failure is captured, never throws, and still emails', async () => {
        mockPauseRow();
        mockNotifyWorkspace.mockRejectedValue(new Error('fcm down'));

        await expect(recordSendFailure(PAGE, 'our_fault')).resolves.toBeUndefined();
        await flush();

        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.any(Error),
            'pageAutoPause.autoPauseNotificationFailed',
            expect.objectContaining({ extra: expect.objectContaining({ pageId: PAGE }) }),
        );
        // The email is the channel that reaches a merchant who isn't looking at
        // the app. A dead push transport must not take it down with it — the
        // dedup below fails OPEN for exactly this reason.
        expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });

    it('releases the dedup key when the email send THROWS (network-level failure)', async () => {
        mockPauseRow();
        // No try/catch around emailService.send's `fetch`: DNS failure, socket
        // reset, TLS error and timeout arrive as a throw, NOT as success:false.
        // Releasing only on success:false left the likelier outage shape holding
        // the key for 24h, with the crossing guard guaranteeing no retry.
        mockEmailSend.mockRejectedValue(new TypeError('fetch failed'));
        await recordSendFailure(PAGE, 'our_fault');
        await flush();

        expect(mockDel).toHaveBeenCalledWith(`notif:auto_pause_email:${PAGE}`);
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('fetch failed') }),
            'pageAutoPause.autoPauseEmailFailed',
            expect.objectContaining({ extra: { pageId: PAGE, userId: 'user-1' } }),
        );
    });

    it('sends nothing for a WhatsApp pause — the copy is Facebook-only', async () => {
        mockPauseRow();
        // WhatsApp reaches this threshold for real (WABA quality restriction,
        // policy block; the 190 case short-circuits in whatsappAdapter). Telling
        // that merchant to reconnect the page and check their Facebook password
        // is false on every clause — a WABA token has its own reconnect flow.
        await recordSendFailure(PAGE, 'our_fault', 'whatsapp');
        await flush();

        expect(mockNotifyWorkspace).not.toHaveBeenCalled();
        expect(mockNotifyUser).not.toHaveBeenCalled();
        expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('still notifies for instagram, and for the comment path that passes no platform', async () => {
        mockPauseRow();
        await recordSendFailure(PAGE, 'our_fault', 'instagram');
        await flush();
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        mockSet.mockResolvedValue('OK');
        mockOwnerInfo();
        mockPauseRow();
        // commentProcessor calls recordSendFailure with no platform at all.
        await recordSendFailure(PAGE, 'our_fault');
        await flush();
        expect(mockNotifyWorkspace).toHaveBeenCalledTimes(1);
    });
});

describe('isNotifiableAutoPausePlatform', () => {
    // An ALLOWLIST: a channel added later must default to silence rather than
    // inherit Facebook copy by omission.
    it.each([[undefined], ['facebook'], ['instagram']])('%s → notify', (platform) => {
        expect(isNotifiableAutoPausePlatform(platform)).toBe(true);
    });

    it.each([['whatsapp'], ['tiktok'], ['webchat']])('%s → stay silent', (platform) => {
        expect(isNotifiableAutoPausePlatform(platform)).toBe(false);
    });
});
