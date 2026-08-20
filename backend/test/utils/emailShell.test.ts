import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'http://localhost:3001',
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
 * The shell feeds twelve emails, so a change to it is twelve changes. The
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
            leads: [{ name: 'Ahmad', phone: '+963900000000', sourceType: 'message', createdAt: new Date('2026-08-19T10:00:00Z'), summary: 'asked about price' }],
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

    it('leaves no inline text colour the dark block cannot reach', () => {
        // The assertion above proves the RULE exists. It does not prove anything
        // obeys it — which is how the first version of this shell shipped a card
        // that went dark while the lead rows and the whole invite body stayed
        // #18181b at 1.03:1 against it. An element is reachable if the descendant
        // sweep covers its tag inside .card, or it carries a class the block names.
        const SWEPT_TAGS = ['td', 'th', 'p', 'h1', 'span', 'div', 'strong', 'b', 'a'];
        const BLOCK_CLASSES = ['soft', 'panel', 'foot', 'cta', 'ink', 'ld-cell', 'ld-row', 'ld-head'];

        const unreachable: string[] = [];
        const tagRe = /<([a-z][a-z0-9]*)\b([^>]*\bstyle="[^"]*(?:^|[;"\s])color:[^"]*"[^>]*)>/gi;
        for (const m of html.matchAll(tagRe)) {
            const tag = m[1];
            const attrs = m[2];
            const classMatch = /class="([^"]*)"/.exec(attrs);
            const classes = (classMatch ? classMatch[1] : '').split(/\s+/).filter(Boolean);
            const swept = SWEPT_TAGS.indexOf(tag.toLowerCase()) !== -1;
            const named = classes.some((c) => BLOCK_CLASSES.indexOf(c) !== -1);
            if (!swept && !named) unreachable.push('<' + tag + ' class="' + classes.join(' ') + '">');
        }

        expect(unreachable).toEqual([]);
    });

    it('serves the logo from the fixed asset origin, not the environment URL', () => {
        // config.frontendUrl is localhost here, exactly as it is in dev. An email
        // outlives the environment that sent it, so the asset host must not track
        // it — a message opened next month still has to resolve its logo.
        expect(html).toContain('https://jawab24.com/brand/logo-small.png');
        expect(html).not.toContain('http://localhost:3001/brand/');
    });

    it('keeps the canvas and the card on the same side of the theme', () => {
        // A dark card on a light canvas is the half-migration this shell shipped
        // once already. Both must flip, or neither should.
        expect(html).toContain('<body class="ground"');
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
        // Whatever the body links to has to survive into the text half — as a
        // USABLE url. Comparing the text against the escaped href scraped from
        // the HTML would pass by construction; decode it first, and require at
        // least one link so the loop cannot pass vacuously.
        const hrefs = [...html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]);
        expect(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs.slice(0, 3)) {
            expect(text).toContain(href.replace(/&amp;/g, '&'));
        }
    });
});

describe('footer language', () => {
    it('writes the Arabic footer for an Arabic email', () => {
        const { html } = T.trialEndingEmailTemplate({
            lang: 'ar', name: 'متجر الشام', trialEndLabel: '٢٥ أغسطس', pricingUrl: URL,
        });

        // Pins the locale the footer is derived from. Forcing it to English left
        // every Arabic email with an English footer and no test noticed.
        expect(html).toContain('إعدادات الحساب');
        expect(html).not.toContain('Account settings');
    });

    it('gives the deliberately bilingual invite a footer in both languages', () => {
        const { html } = T.inviteEmailTemplate({ workspaceName: 'Acme', inviteUrl: URL });

        // The invite sets lang:'ar' to pick a layout direction while rendering
        // both languages in its body. Inferring one footer language from that is
        // how it ended up Arabic-only.
        expect(html).toContain('ردود تلقائية على فيسبوك وإنستغرام وواتساب');
        expect(html).toContain('Automatic replies for Facebook, Instagram and WhatsApp');
        // An invitee has no account, so the auth-gated preferences link is a
        // login wall sent inside a sign-up invitation.
        expect(html).not.toContain('/settings');
    });
});
