/**
 * Tests: trial lifecycle notices (ENDING reminder + ENDED "last try").
 * Verifies:
 *   - both channels fire for a due trial, then the subscription is stamped
 *   - the stamp is what makes a re-run a no-op (query filters on it)
 *   - no-backfill invariant, per sweep: the reminder window is strictly in the
 *     FUTURE (gt now); the ended sweep looks back at most ENDED_LOOKBACK_DAYS
 *   - the ended sweep only targets un-converted trials (status trialing or
 *     past_due, payment_method IS NULL)
 *   - a failed in-app notification leaves the row un-stamped (retry tomorrow)
 *   - a failed email still stamps (best-effort second channel)
 *   - missing email → in-app only, still stamped
 *   - language selection drives copy, pricing URL and date format
 *   - the bell row's date is formatted per locale, not once for all of them
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    selectRows,
    updateSetMock,
    updateWhereMock,
    emailSendMock,
    sendNotificationMock,
    gtSpy,
    lteSpy,
    inArraySpy,
    isNullSpy,
} = vi.hoisted(() => ({
    selectRows: { value: [] as unknown[] },
    updateSetMock: vi.fn(),
    updateWhereMock: vi.fn().mockResolvedValue(undefined),
    emailSendMock: vi.fn(),
    sendNotificationMock: vi.fn(),
    gtSpy: vi.fn(),
    lteSpy: vi.fn(),
    inArraySpy: vi.fn(),
    isNullSpy: vi.fn(),
}));

vi.mock('../db', () => {
    // The service issues exactly one SELECT, terminal at .where(...).
    const makeChain = () => {
        const chain: Record<string, unknown> = {};
        chain.from = vi.fn(() => chain);
        chain.innerJoin = vi.fn(() => chain);
        chain.leftJoin = vi.fn(() => chain);
        chain.where = vi.fn(() => Promise.resolve(selectRows.value));
        return chain;
    };

    return {
        db: {
            select: vi.fn(() => makeChain()),
            update: vi.fn(() => ({
                set: updateSetMock.mockReturnThis(),
                where: updateWhereMock,
            })),
        },
    };
});

// Partial mock: keep real drizzle operators (schema building needs them) but spy
// on the two that encode the reminder window, so the no-backfill bound is pinned.
vi.mock('drizzle-orm', async (importOriginal) => {
    const actual = await importOriginal<typeof import('drizzle-orm')>();
    return {
        ...actual,
        gt: (...args: Parameters<typeof actual.gt>) => { gtSpy(...args); return actual.gt(...args); },
        lte: (...args: Parameters<typeof actual.lte>) => { lteSpy(...args); return actual.lte(...args); },
        inArray: (...args: Parameters<typeof actual.inArray>) => { inArraySpy(...args); return actual.inArray(...args); },
        isNull: (...args: Parameters<typeof actual.isNull>) => { isNullSpy(...args); return actual.isNull(...args); },
    };
});

vi.mock('../services/email', () => ({
    emailService: { send: emailSendMock, setLogger: vi.fn() },
}));

// Only the transport is mocked — NOTIFICATION_TEMPLATES stays real so the test
// exercises the actual shipped copy and its {trialEnd} placeholder.
vi.mock('../services/notifications', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/notifications')>();
    return {
        NOTIFICATION_TEMPLATES: actual.NOTIFICATION_TEMPLATES,
        notificationService: { sendNotification: sendNotificationMock },
    };
});

vi.mock('../utils/sentryHelpers', () => ({ captureError: vi.fn() }));

vi.mock('../config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        resend: { fromName: 'Jawab24', fromEmail: 'info@jawab24.com', replyToEmail: '' },
        // Importing the real notifications module (for NOTIFICATION_TEMPLATES)
        // pulls in lib/redis, which reads this at import time. `lazyConnect`
        // means no socket is ever opened.
        redis: { host: '127.0.0.1', port: 6379, password: undefined },
    },
}));

import {
    runTrialEndingReminders,
    runTrialEndedNotices,
    REMINDER_LEAD_DAYS,
    ENDED_LOOKBACK_DAYS,
    buildTrialEndingBodies,
} from '../services/trialReminders';
import { formatDateLong } from '../utils/formatDate';
import { NOTIFICATION_TEMPLATES } from '../services/notifications';
import { subscriptions } from '../db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeRow(overrides: Partial<{
    subscriptionId: string;
    userId: string;
    trialEndsAt: Date;
    email: string | null;
    name: string | null;
    dashboardLanguage: string | null;
}> = {}) {
    return {
        subscriptionId: overrides.subscriptionId ?? 'sub-1',
        userId: overrides.userId ?? 'user-1',
        trialEndsAt: overrides.trialEndsAt ?? new Date(Date.now() + 2 * DAY_MS),
        email: overrides.email === undefined ? 'merchant@example.com' : overrides.email,
        name: overrides.name === undefined ? 'Nour' : overrides.name,
        dashboardLanguage: overrides.dashboardLanguage ?? null,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    selectRows.value = [];
    emailSendMock.mockResolvedValue({ success: true, id: 'resend-1', emailSendId: 'send-1' });
    sendNotificationMock.mockResolvedValue('notif-1');
    updateWhereMock.mockResolvedValue(undefined);
});

describe('runTrialEndingReminders', () => {
    it('notifies in-app, emails, and stamps the subscription', async () => {
        selectRows.value = [makeRow()];

        const result = await runTrialEndingReminders();

        expect(result).toEqual({ due: 1, notified: 1, emailed: 1, errors: 0 });
        expect(sendNotificationMock).toHaveBeenCalledWith('user-1', expect.objectContaining({
            type: 'trial_ending',
        }));
        expect(emailSendMock).toHaveBeenCalledWith(expect.objectContaining({
            to: 'merchant@example.com',
            type: 'trial_ending',
            userId: 'user-1',
        }));
        // The stamp is the idempotency mechanism — without it the daily cron
        // would warn the same merchant on each of the three remaining days.
        expect(updateSetMock).toHaveBeenCalledWith({ trialEndingNotifiedAt: expect.any(Date) });
        expect(updateWhereMock).toHaveBeenCalledTimes(1);
    });

    it('never looks back: the window starts strictly in the future', async () => {
        const before = Date.now();
        await runTrialEndingReminders();
        const after = Date.now();

        // gt(trial_ends_at, now) is what keeps already-expired trials out of the
        // result set. If this bound is ever relaxed, the 30 silently-expired
        // trials of 2026-07-31 would all be emailed at once.
        expect(gtSpy).toHaveBeenCalledTimes(1);
        const [gtColumn, gtValue] = gtSpy.mock.calls[0] as [unknown, Date];
        expect(gtColumn).toBe(subscriptions.trialEndsAt);
        expect(gtValue.getTime()).toBeGreaterThanOrEqual(before);
        expect(gtValue.getTime()).toBeLessThanOrEqual(after);

        const [lteColumn, lteValue] = lteSpy.mock.calls[0] as [unknown, Date];
        expect(lteColumn).toBe(subscriptions.trialEndsAt);
        expect(lteValue.getTime() - gtValue.getTime()).toBe(REMINDER_LEAD_DAYS * DAY_MS);
    });

    it('does not stamp when the in-app notification fails, so tomorrow retries', async () => {
        selectRows.value = [makeRow()];
        sendNotificationMock.mockRejectedValue(new Error('fcm down'));

        const result = await runTrialEndingReminders();

        expect(result).toEqual({ due: 1, notified: 0, emailed: 0, errors: 1 });
        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateWhereMock).not.toHaveBeenCalled();
    });

    it('still stamps when only the email fails — the merchant was warned in-app', async () => {
        selectRows.value = [makeRow()];
        emailSendMock.mockResolvedValue({ success: false, error: 'resend 500' });

        const result = await runTrialEndingReminders();

        expect(result).toEqual({ due: 1, notified: 1, emailed: 0, errors: 0 });
        expect(updateWhereMock).toHaveBeenCalledTimes(1);
    });

    it('warns in-app only when the account has no email on file', async () => {
        selectRows.value = [makeRow({ email: null })];

        const result = await runTrialEndingReminders();

        expect(result).toEqual({ due: 1, notified: 1, emailed: 0, errors: 0 });
        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateWhereMock).toHaveBeenCalledTimes(1);
    });

    it('uses the dashboard language for copy and the pricing link, defaulting to Arabic', async () => {
        selectRows.value = [
            makeRow({ subscriptionId: 'sub-en', userId: 'user-en', dashboardLanguage: 'en' }),
            makeRow({ subscriptionId: 'sub-ar', userId: 'user-ar', dashboardLanguage: null }),
        ];

        await runTrialEndingReminders();

        const [enSend, arSend] = emailSendMock.mock.calls.map(c => c[0]);
        expect(enSend.html).toContain('https://jawab24.com/en/pricing');
        expect(enSend.subject).toMatch(/free trial/i);
        expect(arSend.html).toContain('https://jawab24.com/ar/pricing');
        expect(arSend.html).toContain('dir="rtl"');
    });

    it('continues to the next subscription after one fails', async () => {
        selectRows.value = [
            makeRow({ subscriptionId: 'sub-bad', userId: 'user-bad' }),
            makeRow({ subscriptionId: 'sub-ok', userId: 'user-ok' }),
        ];
        sendNotificationMock
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('notif-2');

        const result = await runTrialEndingReminders();

        expect(result).toEqual({ due: 2, notified: 1, emailed: 1, errors: 1 });
        expect(updateWhereMock).toHaveBeenCalledTimes(1);
    });
});

describe('runTrialEndedNotices', () => {
    it('notifies in-app, emails, and stamps trialEndedNotifiedAt', async () => {
        selectRows.value = [makeRow({ trialEndsAt: new Date(Date.now() - DAY_MS) })];

        const result = await runTrialEndedNotices();

        expect(result).toEqual({ due: 1, notified: 1, emailed: 1, errors: 0 });
        expect(sendNotificationMock).toHaveBeenCalledWith('user-1', expect.objectContaining({
            type: 'trial_ended',
        }));
        expect(emailSendMock).toHaveBeenCalledWith(expect.objectContaining({
            to: 'merchant@example.com',
            type: 'trial_ended',
            userId: 'user-1',
        }));
        // Stamps the ENDED column, not the ENDING one — the two sweeps must
        // never consume each other's idempotency marker.
        expect(updateSetMock).toHaveBeenCalledWith({ trialEndedNotifiedAt: expect.any(Date) });
        expect(updateWhereMock).toHaveBeenCalledTimes(1);
    });

    it('bounds the sweep to ENDED_LOOKBACK_DAYS — the no-backfill guard', async () => {
        const before = Date.now();
        await runTrialEndedNotices();
        const after = Date.now();

        // lte(trial_ends_at, now): only trials that have actually ended.
        const [lteColumn, lteValue] = lteSpy.mock.calls[0] as [unknown, Date];
        expect(lteColumn).toBe(subscriptions.trialEndsAt);
        expect(lteValue.getTime()).toBeGreaterThanOrEqual(before);
        expect(lteValue.getTime()).toBeLessThanOrEqual(after);

        // gt(trial_ends_at, now - lookback): a long-expired trial (the ~30
        // silent rows of 2026-07-31) is never noticed retroactively.
        const [gtColumn, gtValue] = gtSpy.mock.calls[0] as [unknown, Date];
        expect(gtColumn).toBe(subscriptions.trialEndsAt);
        expect(lteValue.getTime() - gtValue.getTime()).toBe(ENDED_LOOKBACK_DAYS * DAY_MS);
    });

    it('targets only un-converted trials: trialing/past_due with no payment method', async () => {
        await runTrialEndedNotices();

        expect(inArraySpy).toHaveBeenCalledWith(subscriptions.status, ['trialing', 'past_due']);
        const isNullColumns = isNullSpy.mock.calls.map(c => c[0]);
        expect(isNullColumns).toContain(subscriptions.paymentMethod);
        expect(isNullColumns).toContain(subscriptions.trialEndedNotifiedAt);
    });

    it('does not stamp when the in-app notification fails, so tomorrow retries', async () => {
        selectRows.value = [makeRow({ trialEndsAt: new Date(Date.now() - DAY_MS) })];
        sendNotificationMock.mockRejectedValue(new Error('fcm down'));

        const result = await runTrialEndedNotices();

        expect(result).toEqual({ due: 1, notified: 0, emailed: 0, errors: 1 });
        expect(emailSendMock).not.toHaveBeenCalled();
        expect(updateWhereMock).not.toHaveBeenCalled();
    });

    it('still stamps when only the email fails — the merchant was told in-app', async () => {
        selectRows.value = [makeRow({ trialEndsAt: new Date(Date.now() - DAY_MS) })];
        emailSendMock.mockResolvedValue({ success: false, error: 'resend 500' });

        const result = await runTrialEndedNotices();

        expect(result).toEqual({ due: 1, notified: 1, emailed: 0, errors: 0 });
        expect(updateWhereMock).toHaveBeenCalledTimes(1);
    });

    it('uses the dashboard language for copy and the pricing link, defaulting to Arabic', async () => {
        selectRows.value = [
            makeRow({ subscriptionId: 'sub-en', userId: 'user-en', dashboardLanguage: 'en', trialEndsAt: new Date(Date.now() - DAY_MS) }),
            makeRow({ subscriptionId: 'sub-ar', userId: 'user-ar', dashboardLanguage: null, trialEndsAt: new Date(Date.now() - DAY_MS) }),
        ];

        await runTrialEndedNotices();

        const [enSend, arSend] = emailSendMock.mock.calls.map(c => c[0]);
        expect(enSend.html).toContain('https://jawab24.com/en/pricing');
        expect(enSend.subject).toMatch(/trial has ended/i);
        expect(arSend.html).toContain('https://jawab24.com/ar/pricing');
        expect(arSend.html).toContain('dir="rtl"');
    });
});

describe('buildTrialEndingBodies', () => {
    it('formats the date separately per locale, leaving no placeholder behind', () => {
        const bodies = buildTrialEndingBodies(new Date('2026-08-11T09:30:00Z'));

        // The bell row persists EVERY locale and the client renders whichever
        // matches the current UI language. One shared pre-formatted date would
        // put an Arabic date in front of a merchant who switches to English.
        expect(bodies.en).toContain('August');
        expect(bodies.ar).not.toContain('August');
        for (const text of Object.values(bodies)) {
            expect(text).not.toContain('{trialEnd}');
        }
    });

    it('covers every locale the shipped template declares', () => {
        const bodies = buildTrialEndingBodies(new Date('2026-08-11T09:30:00Z'));
        expect(Object.keys(bodies).sort())
            .toEqual(Object.keys(NOTIFICATION_TEMPLATES.trial_ending.bodies).sort());
    });
});

describe('formatDateLong', () => {
    it('renders a date without a time component in both languages', () => {
        const d = new Date('2026-08-11T09:30:00Z');
        expect(formatDateLong(d, 'en')).toMatch(/August/);
        // No ":" — a "three days left" reminder should not imply an exact hour.
        expect(formatDateLong(d, 'en')).not.toContain(':');
        expect(formatDateLong(d, 'ar')).not.toContain(':');
    });
});
