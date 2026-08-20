import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        resend: {
            fromName: 'Jawab24',
            fromEmail: 'info@jawab24.com',
            replyToEmail: 'support@jawab24.com',
        },
    },
}));

import * as T from '../../src/utils/emailTemplates';
import { htmlToPlainText } from '../../src/utils/htmlUtils';

/**
 * Every template that renders through the shared shell, in both locales.
 *
 * The shell feeds thirteen emails, so a change to it is thirteen changes. The
 * per-template suites each check their own copy; nothing checked that the
 * scaffold around that copy survived — which is exactly the blast radius a
 * shell edit has.
 */
const URL = 'https://jawab24.com/en/pricing';

function shellRenders(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const lang of ['en', 'ar'] as const) {
        const name = 'Sham Store';
        out.push([`waitlist-${lang}`, T.waitlistEmailTemplate({
            subject: 'S', body: lang === 'ar' ? 'مرحبا بك' : 'Welcome aboard',
            unsubscribeUrl: 'https://jawab24.com/u?t=1',
        })]);
        out.push([`welcome-${lang}`, T.subscriptionWelcomeEmailTemplate({ lang, name, planName: 'Growth', dashboardUrl: URL }).html]);
        out.push([`trialEnding-${lang}`, T.trialEndingEmailTemplate({ lang, name, trialEndLabel: '25 Aug', pricingUrl: URL }).html]);
        out.push([`trialEnded-${lang}`, T.trialEndedEmailTemplate({ lang, name, pricingUrl: URL }).html]);
        out.push([`paymentFailed-${lang}`, T.paymentFailedEmailTemplate({ lang, name, amountLabel: '$29', graceEndLabel: '1 Sep', payUrl: URL }).html]);
        out.push([`suspended-${lang}`, T.serviceSuspendedEmailTemplate({ lang, name, stoppedSinceLabel: '18 Aug', ctaUrl: URL, ctaVariant: 'pay' }).html]);
        out.push([`recovered-${lang}`, T.paymentRecoveredEmailTemplate({ lang, name, periodEndLabel: '25 Sep', dashboardUrl: URL }).html]);
        out.push([`autoPaused-${lang}`, T.autoPausedEmailTemplate({ lang, pageName: 'Sham', dashboardUrl: URL }).html]);
        out.push([`reconnect-${lang}`, T.pageReconnectEmailTemplate({ lang, pageName: 'Sham', cause: 'token_expired', dashboardUrl: URL }).html]);
        out.push([`digest-${lang}`, T.leadDigestEmailTemplate({
            lang, leadCount: 1, dashboardUrl: URL,
            leads: [{ name: 'A', phone: '+963900', reason: 'price', source: 'dm', capturedAt: new Date('2026-08-19T10:00:00Z') }],
        }).html]);
    }
    out.push(['invite', T.inviteEmailTemplate({ workspaceName: 'Acme', inviteUrl: URL }).html]);
    out.push(['notice', T.accountNoticeEmailTemplate({ name: 'Sham Store', subject: 'S', body: 'Body line.' }).html]);
    return out;
}

describe.each(shellRenders())('shell invariants — %s', (_name, html) => {
    it('leads with the logo lockup, not a coloured bar', () => {
        expect(html).toContain('/brand/logo-small.png');
        expect(html).not.toContain('background-color:#0d9488;padding:24px 32px');
    });

    it('declares dark-mode support', () => {
        expect(html).toContain('name="color-scheme"');
        expect(html).toContain('prefers-color-scheme: dark');
    });

    it('is a complete, fully-substituted document', () => {
        expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(html.trimEnd().endsWith('</html>')).toBe(true);
        // A missing param surfaces as the string "undefined" in the body, and an
        // unclosed template literal as a live `${`. Both ship silently otherwise.
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('${');
    });

    it('yields a usable plain-text part', () => {
        const text = htmlToPlainText(html);

        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(/<\/[a-z]+>/i);
        // Whatever the body links to has to survive into the text half.
        const hrefs = html.match(/href="(https?:[^"]+)"/g) ?? [];
        for (const href of hrefs.slice(0, 3)) {
            expect(text).toContain(href.slice(6, -1));
        }
    });
});
