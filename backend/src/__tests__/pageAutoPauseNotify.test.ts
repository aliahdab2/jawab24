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
} = vi.hoisted(() => ({
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
vi.mock('../services/email', () => ({ emailService: { send: mockEmailSend } }));
vi.mock('../utils/emailTemplates', () => ({ autoPausedEmailTemplate: mockTemplate }));
vi.mock('../config', () => ({ config: { frontendUrl: 'https://jawab24.com' } }));

import { recordSendFailure, PAUSE_THRESHOLD } from '../services/pageAutoPause';

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

    it('a notification failure is captured and never throws into the reply path', async () => {
        mockPauseRow();
        mockNotifyWorkspace.mockRejectedValue(new Error('fcm down'));

        await expect(recordSendFailure(PAGE, 'our_fault')).resolves.toBeUndefined();
        await flush();

        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.any(Error),
            'pageAutoPause.notifyMerchantAutoPaused failed',
            expect.objectContaining({ extra: { pageId: PAGE } }),
        );
        expect(mockEmailSend).not.toHaveBeenCalled();
    });
});
