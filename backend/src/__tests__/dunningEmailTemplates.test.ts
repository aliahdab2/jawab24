/**
 * Tests: dunning email templates (payment_failed / service_suspended /
 * payment_recovered) + formatMoney.
 * Pure rendering checks — no DB, no email service. Mirrors
 * subscriptionWelcomeEmail.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
    paymentFailedEmailTemplate,
    serviceSuspendedEmailTemplate,
    paymentRecoveredEmailTemplate,
} from '../utils/emailTemplates';
import { formatMoney } from '../utils/formatMoney';

/** No un-substituted i18n placeholder may ever reach a merchant. */
function expectNoPlaceholderResidue(html: string, subject: string) {
    for (const s of [html, subject]) {
        expect(s).not.toMatch(/\{name\}/);
        expect(s).not.toMatch(/\{amount\}/);
        expect(s).not.toMatch(/\{graceEnd\}/);
        expect(s).not.toMatch(/\{stoppedSince\}/);
        expect(s).not.toMatch(/\{periodEnd\}/);
    }
}

describe('paymentFailedEmailTemplate', () => {
    const base = {
        name: 'Nour',
        amountLabel: 'US$79.00',
        graceEndLabel: '16 August',
        payUrl: 'https://invoice.stripe.com/i/acct_1/test_abc123',
    };

    it('renders Arabic RTL with amount, grace date and the hosted invoice CTA', () => {
        const { subject, html } = paymentFailedEmailTemplate({ ...base, lang: 'ar', graceEndLabel: '16 آب' });

        expect(subject).toBe('إجراء مطلوب: تعذّر تجديد اشتراكك في Jawab24');
        expect(html).toContain('lang="ar"');
        expect(html).toContain('dir="rtl"');
        expect(html).toContain('Cairo'); // RTL font stack
        expect(html).toContain('مرحباً Nour');
        expect(html).toContain('US$79.00');
        expect(html).toContain('16 آب');
        expect(html).toContain('href="https://invoice.stripe.com/i/acct_1/test_abc123"');
        expect(html).toContain('إتمام الدفع الآن');
        expect(html).toContain('تفعيل الشراء عبر الإنترنت'); // update-card guidance
        expectNoPlaceholderResidue(html, subject);
    });

    it('renders English LTR', () => {
        const { subject, html } = paymentFailedEmailTemplate({ ...base, lang: 'en' });

        expect(subject).toContain('renewal payment did not go through');
        expect(html).toContain('lang="en"');
        expect(html).toContain('dir="ltr"');
        expect(html).toContain('Hi Nour');
        expect(html).toContain('until 16 August');
        expect(html).toContain('Pay now');
        expectNoPlaceholderResidue(html, subject);
    });

    it('falls back to the date-free warning when graceEndLabel is null', () => {
        const { subject, html } = paymentFailedEmailTemplate({ ...base, lang: 'en', graceEndLabel: null });

        expect(html).toContain('within the next few days');
        expect(html).not.toContain('until 16 August');
        expectNoPlaceholderResidue(html, subject);
    });

    it('falls back to the amount-free intro when amountLabel is null', () => {
        const { subject, html } = paymentFailedEmailTemplate({ ...base, lang: 'en', amountLabel: null });

        expect(html).toContain('we tried to renew your Jawab24 subscription, but');
        expect(html).not.toContain('US$79.00');
        expectNoPlaceholderResidue(html, subject);
    });

    it('escapes hostile caller values (name, amount, URL)', () => {
        const { html } = paymentFailedEmailTemplate({
            lang: 'en',
            name: '<script>alert(1)</script>',
            amountLabel: 'US$79.00 <b>x</b>',
            graceEndLabel: '16 <i>Aug</i>',
            payUrl: 'https://invoice.stripe.com/i/a?x=1&y=2',
        });

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<b>x</b>');
        expect(html).not.toContain('<i>Aug</i>');
        expect(html).toContain('href="https://invoice.stripe.com/i/a?x=1&amp;y=2"');
    });

    it('survives a multi-line name without breaking the markup', () => {
        const { html } = paymentFailedEmailTemplate({ ...base, lang: 'ar', name: 'شركة\nإن ميديا' });
        expect(html).toContain('شركة\nإن ميديا');
    });
});

describe('serviceSuspendedEmailTemplate', () => {
    const base = {
        name: 'Nour',
        stoppedSinceLabel: '16 August',
    };

    it("renders the 'pay' variant with the open invoice URL", () => {
        const { subject, html } = serviceSuspendedEmailTemplate({
            ...base,
            lang: 'ar',
            stoppedSinceLabel: '16 آب',
            ctaUrl: 'https://invoice.stripe.com/i/acct_1/test_abc123',
            ctaVariant: 'pay',
        });

        expect(subject).toBe('توقفت الردود التلقائية — اشتراكك في Jawab24 بانتظار الدفع');
        expect(html).toContain('dir="rtl"');
        expect(html).toContain('16 آب');
        expect(html).toContain('href="https://invoice.stripe.com/i/acct_1/test_abc123"');
        expect(html).toContain('إتمام الدفع');
        expect(html).toContain('محفوظة كما هي'); // what-remains reassurance
        expectNoPlaceholderResidue(html, subject);
    });

    it("renders the 'resubscribe' variant pointing at pricing", () => {
        const { subject, html } = serviceSuspendedEmailTemplate({
            ...base,
            lang: 'en',
            ctaUrl: 'https://jawab24.com/en/pricing',
            ctaVariant: 'resubscribe',
        });

        expect(html).toContain('stopped on 16 August');
        expect(html).toContain('href="https://jawab24.com/en/pricing"');
        expect(html).toContain('Choose a plan');
        expect(html).not.toContain('Complete payment');
        expectNoPlaceholderResidue(html, subject);
    });
});

describe('paymentRecoveredEmailTemplate', () => {
    it('renders the confirmation with the covered-until date', () => {
        const { subject, html } = paymentRecoveredEmailTemplate({
            lang: 'ar',
            name: 'Nour',
            periodEndLabel: '13 أيلول',
            dashboardUrl: 'https://jawab24.com/dashboard',
        });

        expect(subject).toBe('تم استلام الدفعة — اشتراكك في Jawab24 فعّال');
        expect(html).toContain('13 أيلول');
        expect(html).toContain('href="https://jawab24.com/dashboard"');
        expectNoPlaceholderResidue(html, subject);
    });

    it('renders in English', () => {
        const { subject, html } = paymentRecoveredEmailTemplate({
            lang: 'en',
            name: 'Nour',
            periodEndLabel: 'September 13',
            dashboardUrl: 'https://jawab24.com/dashboard',
        });

        expect(subject).toContain('Payment received');
        expect(html).toContain('active until September 13');
        expectNoPlaceholderResidue(html, subject);
    });
});

describe('formatMoney', () => {
    it('formats cents-based currencies from the smallest unit', () => {
        expect(formatMoney(7900, 'usd', 'en')).toContain('79');
        expect(formatMoney(7900, 'usd', 'en')).not.toContain('7,900');
    });

    it('does not divide zero-decimal currencies', () => {
        expect(formatMoney(500, 'jpy', 'en')).toContain('500');
    });

    it('renders Arabic locale output without throwing', () => {
        const out = formatMoney(7900, 'usd', 'ar');
        expect(out.length).toBeGreaterThan(0);
    });

    it('falls back to "amount CODE" on an unknown currency', () => {
        expect(formatMoney(7900, 'zz', 'en')).toBe('79 ZZ');
    });
});
