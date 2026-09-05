import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Running out of Smart Replies is SILENT by construction: customers keep
 * writing and receive a generic fallback, so a merchant who is not looking at
 * the dashboard (bell) and has not installed the app (push) learned about the
 * wall from the business they lost. Email is the channel that reaches them
 * anyway — these tests pin that it goes out on the same crossing that fires the
 * card, once, to the right address, in the merchant's language, and that
 * neither channel can silence the other.
 */

const {
    mockRedisSet, mockCaptureError, mockSelect,
    mockNotify, mockEmailSend,
} = vi.hoisted(() => ({
    mockRedisSet: vi.fn().mockResolvedValue('OK'),
    mockCaptureError: vi.fn(),
    mockSelect: vi.fn(),
    mockNotify: vi.fn().mockResolvedValue('notif-1'),
    mockEmailSend: vi.fn().mockResolvedValue({ success: true, id: 'email-1' }),
}));

vi.mock('../lib/redis', () => ({ redis: { set: mockRedisSet } }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: mockCaptureError }));
vi.mock('../db', () => ({ db: { select: mockSelect } }));
vi.mock('../services/notifications', () => ({
    notificationService: { sendTemplateNotification: mockNotify },
}));
vi.mock('../services/email', async () => {
    // The REAL EmailService with only the transport stubbed — `trySend` is part
    // of what is under test (a send that resolves `success:false` must be
    // reported, and that distinction lives in `trySend`, not in this file).
    const actual = await vi.importActual<typeof import('../services/email')>('../services/email');
    const service = new actual.EmailService();
    service.send = mockEmailSend;
    return { ...actual, emailService: service };
});
vi.mock('../config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        // Read by the real email shell (`getBrandName`) and by the transport.
        resend: { fromName: 'Jawab24', fromEmail: 'hello@jawab24.com', apiKey: 'test' },
    },
}));

// The email templates are NOT mocked: a missing or misspelled i18n key must fail
// here rather than ship an email with a raw key in the subject line.
import { subscriptionsService, isEmailableAiUsageType } from '../services/subscriptions';

const USER = 'user-1';

/** One `db.select(...).from(...).leftJoin(...).where(...).limit(1)` result. */
function mockRecipient(row: Record<string, unknown> | null): void {
    const rows = row ? [row] : [];
    mockSelect.mockReturnValue({
        from: () => ({
            leftJoin: () => ({ where: () => ({ limit: async () => rows }) }),
        }),
    });
}

function mockPlan(limit: number | null): void {
    vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
        plan: { maxAiRepliesPerMonth: limit },
    } as unknown as Awaited<ReturnType<typeof subscriptionsService.getUserSubscription>>);
}

function mockBalance(balance: number): void {
    vi.spyOn(subscriptionsService, 'getTopupBalance').mockResolvedValue(balance);
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
    mockEmailSend.mockResolvedValue({ success: true, id: 'email-1' });
    mockNotify.mockResolvedValue('notif-1');
    mockRecipient({ email: 'owner@example.com', name: 'سامر', dashboardLanguage: 'ar' });
});

const cross80 = () => subscriptionsService.maybeNotifyAiUsageThreshold(USER, 799, 800, new Date('2026-09-01T00:00:00Z'));
const cross100 = () => subscriptionsService.maybeNotifyAiUsageThreshold(USER, 999, 1000, new Date('2026-09-01T00:00:00Z'));

describe('AI usage threshold email', () => {
    it('emails the merchant when they cross 80% of the plan cap', async () => {
        mockPlan(1000);
        mockBalance(0);

        await cross80();

        expect(mockNotify).toHaveBeenCalledWith(USER, 'ai_usage_warning_80', expect.anything());
        expect(mockEmailSend).toHaveBeenCalledTimes(1);
        const payload = mockEmailSend.mock.calls[0][0];
        expect(payload.to).toBe('owner@example.com');
        expect(payload.type).toBe('ai_usage_warning');
        expect(payload.userId).toBe(USER);
        // Arabic dashboard → Arabic subject, and the count rendered, not a raw key.
        expect(payload.subject).toContain('80%');
        expect(payload.html).not.toContain('aiUsageWarning');
        expect(payload.html).toContain('سامر');
        // The one number the merchant acts on — how many are LEFT — in
        // Arabic-Indic digits like the rest of the Arabic body (800 of 1000 → 200).
        expect(payload.html).toContain('٢٠٠');
    });

    it('emails in English when the merchant reads the dashboard in English', async () => {
        mockRecipient({ email: 'owner@example.com', name: null, dashboardLanguage: 'en' });
        mockPlan(1000);
        mockBalance(0);

        await cross80();

        const payload = mockEmailSend.mock.calls[0][0];
        expect(payload.subject).toBe("You've used 80% of your monthly Smart Replies");
        // No name on the row: the address' local part is the greeting.
        expect(payload.html).toContain('owner');
        expect(payload.html).toContain('https://jawab24.com/en/pricing');
    });

    it('emails the "replies have stopped" notice when the wall is real', async () => {
        mockPlan(1000);
        mockBalance(0);

        await cross100();

        expect(mockNotify).toHaveBeenCalledWith(USER, 'ai_usage_limit_reached', expect.anything());
        expect(mockEmailSend.mock.calls[0][0].type).toBe('ai_usage_limit');
    });

    it('emails the warning when the top-up balance behind the cap is nearly gone', async () => {
        mockPlan(1000);
        mockBalance(3);

        await cross100();

        expect(mockNotify).toHaveBeenCalledWith(USER, 'ai_usage_topup_low', expect.anything());
        expect(mockEmailSend.mock.calls[0][0].type).toBe('ai_usage_warning');
    });

    it('sends NO email when a real top-up runway absorbs the crossing', async () => {
        // Nothing happened to this merchant — replies keep flowing. An email
        // demanding attention for a non-event is how the ones that matter get
        // ignored; the in-app card still records it.
        mockPlan(1000);
        mockBalance(5000);

        await cross100();

        expect(mockNotify).toHaveBeenCalledWith(USER, 'ai_usage_on_topup', expect.anything());
        expect(mockEmailSend).not.toHaveBeenCalled();
        // Not-sent must mean SKIPPED, not "the composer threw on a variant it
        // cannot render". Without this the assertion above passes even when the
        // exclusion is removed — the mutation that proved it (2026-09-05).
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('still sends the in-app card when the merchant has no email address', async () => {
        mockRecipient(null);
        mockPlan(1000);
        mockBalance(0);

        await cross80();

        expect(mockNotify).toHaveBeenCalledTimes(1);
        expect(mockEmailSend).not.toHaveBeenCalled();
        // Nothing was sent and nothing failed — no error is reported.
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('sends the email even when the in-app notification throws', async () => {
        mockPlan(1000);
        mockBalance(0);
        mockNotify.mockRejectedValue(new Error('notifications table down'));

        await cross80();

        expect(mockEmailSend).toHaveBeenCalledTimes(1);
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('sends the in-app card even when the email transport throws, and reports it', async () => {
        mockPlan(1000);
        mockBalance(0);
        mockEmailSend.mockRejectedValue(new Error('resend unreachable'));

        await cross80();

        expect(mockNotify).toHaveBeenCalledTimes(1);
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('ai_usage_warning_80 email failed') }),
            'subscriptions.aiUsageEmailFailed',
            expect.anything(),
        );
    });

    it('reports a send that resolves as a failure, not only one that throws', async () => {
        mockPlan(1000);
        mockBalance(0);
        mockEmailSend.mockResolvedValue({ success: false, error: 'invalid recipient' });

        await cross80();

        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('invalid recipient') }),
            'subscriptions.aiUsageEmailFailed',
            expect.anything(),
        );
    });

    it('sends nothing twice — the once-per-period claim gates both channels', async () => {
        mockPlan(1000);
        mockBalance(0);
        mockRedisSet.mockResolvedValue(null); // key already held for this period

        await cross80();

        expect(mockNotify).not.toHaveBeenCalled();
        expect(mockEmailSend).not.toHaveBeenCalled();
    });
});

describe('isEmailableAiUsageType', () => {
    it('covers the three actionable crossings and excludes the calm one', () => {
        expect(isEmailableAiUsageType('ai_usage_warning_80')).toBe(true);
        expect(isEmailableAiUsageType('ai_usage_limit_reached')).toBe(true);
        expect(isEmailableAiUsageType('ai_usage_topup_low')).toBe(true);
        expect(isEmailableAiUsageType('ai_usage_on_topup')).toBe(false);
        expect(isEmailableAiUsageType('new_lead')).toBe(false);
    });
});
