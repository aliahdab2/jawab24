/**
 * Tests for the trial lifecycle emails:
 *   - trialLifecycleEmailTemplate rendering across variant × activation × locale
 *   - trial-feedback HMAC token round-trip + forgery rejection
 *
 * Pure functions only — no DB, no email service. The DB-integrated job
 * (window selection, idempotency stamps, suppression) is exercised by the
 * local dry-run in the verification step, consistent with how the repo covers
 * other DB-heavy scheduled jobs.
 */
import { describe, it, expect } from 'vitest';
import { trialLifecycleEmailTemplate } from '../utils/emailTemplates';
import {
    generateTrialFeedbackToken,
    verifyTrialFeedbackToken,
    generateUnsubscribeToken,
} from '../utils/tokens';

const base = {
    lang: 'en' as const,
    activated: true,
    messagesHandled: 3140,
    leadsCaptured: 42,
    daysLeft: 3,
    upgradeUrl: 'https://jawab24.com/en/pricing',
    dashboardUrl: 'https://jawab24.com/en/dashboard',
    unsubscribeUrl: 'https://jawab24.com/unsubscribe?email=a%40b.com&token=x',
    feedbackLinks: [
        { label: 'Too expensive', url: 'https://jawab24.com/trial-feedback?u=U1&reason=too_expensive&token=T1' },
    ],
};

describe('trialLifecycleEmailTemplate', () => {
    it('reminder + activated → value recap, upgrade CTA, no feedback links', () => {
        const { subject, html } = trialLifecycleEmailTemplate({ ...base, variant: 'reminder', activated: true });
        expect(subject).toContain('3'); // days left
        expect(html).toContain('3140'); // messages handled
        expect(html).toContain('42');   // leads captured
        expect(html).toContain('/en/pricing'); // upgrade CTA
        expect(html).not.toContain('/trial-feedback'); // reminders never show churn links
        expect(html).toContain('/unsubscribe');
        expect(html).toContain('lang="en"');
        expect(html).toContain('dir="ltr"');
    });

    it('reminder + NOT activated → activation nudge (no recap), dashboard CTA', () => {
        const { html } = trialLifecycleEmailTemplate({ ...base, variant: 'reminder', activated: false });
        expect(html).not.toContain('3140'); // no value recap when unactivated
        expect(html).toContain("hasn't answered anyone"); // the "switch it on" nudge copy
        expect(html).toContain('/en/dashboard'); // CTA points to the enable flow
    });

    it('ended → win-back with churn feedback links + unsubscribe', () => {
        const { subject, html } = trialLifecycleEmailTemplate({ ...base, variant: 'ended' });
        expect(subject).toContain('has ended');
        expect(html).toContain('/trial-feedback');
        expect(html).toContain('reason=too_expensive');
        expect(html).toContain('/en/pricing');
        expect(html).toContain('/unsubscribe');
    });

    it('ended + activated still shows the value recap', () => {
        const { html } = trialLifecycleEmailTemplate({ ...base, variant: 'ended', activated: true });
        expect(html).toContain('3140');
        expect(html).toContain('42');
    });

    it('Arabic renders RTL with a distinct (non-English) subject', () => {
        const en = trialLifecycleEmailTemplate({ ...base, variant: 'ended', lang: 'en' });
        const ar = trialLifecycleEmailTemplate({ ...base, variant: 'ended', lang: 'ar' });
        expect(ar.html).toContain('lang="ar"');
        expect(ar.html).toContain('dir="rtl"');
        expect(ar.subject).not.toEqual(en.subject);
        expect(ar.subject).toMatch(/[؀-ۿ]/); // contains Arabic
    });

    it('omits the feedback block when no links are provided', () => {
        const { html } = trialLifecycleEmailTemplate({ ...base, variant: 'ended', feedbackLinks: undefined });
        expect(html).not.toContain('/trial-feedback');
    });
});

describe('trial-feedback token', () => {
    const userId = '52247b81-4570-4767-b9d4-d37a553fb177';

    it('round-trips for the same userId', () => {
        const token = generateTrialFeedbackToken(userId);
        expect(verifyTrialFeedbackToken(userId, token)).toBe(true);
    });

    it('rejects a forged / mismatched token', () => {
        expect(verifyTrialFeedbackToken(userId, 'not-the-real-token')).toBe(false);
        expect(verifyTrialFeedbackToken('other-user', generateTrialFeedbackToken(userId))).toBe(false);
    });

    it('is namespaced apart from the unsubscribe token', () => {
        // A leaked unsubscribe token must not double as a feedback token.
        expect(generateTrialFeedbackToken(userId)).not.toEqual(generateUnsubscribeToken(userId));
    });
});
