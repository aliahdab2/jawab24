/**
 * Tests: subscriptionWelcomeEmailTemplate
 * Pure rendering checks — no DB, no email service.
 */
import { describe, it, expect } from 'vitest';
import { subscriptionWelcomeEmailTemplate } from '../utils/emailTemplates';

describe('subscriptionWelcomeEmailTemplate', () => {
    const baseParams = {
        name: 'Ali',
        planName: 'Pro',
        dashboardUrl: 'https://jawab24.com/dashboard',
    };

    it('renders an English subject and body when lang=en', () => {
        const { subject, html } = subscriptionWelcomeEmailTemplate({
            ...baseParams,
            lang: 'en',
        });

        expect(subject).toContain('Welcome to Jawab24');
        expect(subject).toContain('Pro');
        expect(html).toContain('lang="en"');
        expect(html).toContain('dir="ltr"');
        expect(html).toContain('Hi Ali');
        expect(html).toContain('Open dashboard');
        expect(html).toContain('https://jawab24.com/dashboard');
    });

    it('renders an Arabic subject and body when lang=ar', () => {
        const { subject, html } = subscriptionWelcomeEmailTemplate({
            ...baseParams,
            lang: 'ar',
        });

        expect(subject).toContain('Jawab24');
        expect(subject).toContain('Pro');
        expect(html).toContain('lang="ar"');
        expect(html).toContain('dir="rtl"');
        expect(html).toContain('مرحباً Ali');
        expect(html).toContain('افتح لوحة التحكم');
    });

    it('omits the trial block when no trial is provided', () => {
        const { html } = subscriptionWelcomeEmailTemplate({
            ...baseParams,
            lang: 'en',
        });

        expect(html).not.toContain('free trial');
        expect(html).not.toContain('Your free trial');
    });

    it('includes the trial block with end date when trialEndsAt is provided', () => {
        const trialEnd = new Date('2026-06-01T12:00:00Z');
        const { html } = subscriptionWelcomeEmailTemplate({
            ...baseParams,
            lang: 'en',
            trialEndsAt: trialEnd,
        });

        expect(html).toContain('free trial');
        // Stripe's trial_end is a Unix timestamp; we format with Intl. The
        // exact rendered string varies by locale, but the year/month should
        // appear somewhere.
        expect(html).toMatch(/Jun|06/);
    });

    it('escapes HTML in the user name to prevent injection', () => {
        const { html } = subscriptionWelcomeEmailTemplate({
            ...baseParams,
            name: '<script>alert(1)</script>',
            lang: 'en',
        });

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('mentions the separate Stripe invoice email', () => {
        const { html: htmlEn } = subscriptionWelcomeEmailTemplate({
            ...baseParams,
            lang: 'en',
        });
        const { html: htmlAr } = subscriptionWelcomeEmailTemplate({
            ...baseParams,
            lang: 'ar',
        });

        expect(htmlEn).toContain('Stripe');
        expect(htmlAr).toContain('Stripe');
    });
});
