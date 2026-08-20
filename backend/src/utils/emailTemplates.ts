import { config } from '../config';
import { t, tPlural } from './i18n';
import { escapeHtml } from './htmlUtils';
import { formatDateTimeShort } from './formatDate';

/**
 * Detect if text is primarily Arabic/RTL script.
 * Checks for Arabic Unicode range characters.
 */
function isRTLText(text: string): boolean {
    const arabicChars = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g);
    return (arabicChars?.length ?? 0) > text.replace(/\s/g, '').length * 0.3;
}

/** Resolved sender/brand name — single source of the config fallback. */
function getBrandName(): string {
    return config.resend.fromName || 'Jawab24';
}

const RTL_FONT_STACK = "'Cairo','Tajawal',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
const LTR_FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

/**
 * Content-driven presentation for a piece of text: direction, lang, alignment
 * and font stack. Shared by every template that decides RTL from its content
 * (waitlist, account-notice) instead of an explicit `lang` param.
 */
function rtlPresentation(text: string): { rtl: boolean; dir: 'ltr' | 'rtl'; lang: 'ar' | 'en'; align: 'left' | 'right'; fontFamily: string } {
    const rtl = isRTLText(text);
    return {
        rtl,
        dir: rtl ? 'rtl' : 'ltr',
        lang: rtl ? 'ar' : 'en',
        align: rtl ? 'right' : 'left',
        fontFamily: rtl ? RTL_FONT_STACK : LTR_FONT_STACK,
    };
}

/**
 * Locale-driven counterpart of `rtlPresentation` — the same presentation
 * attributes for templates that receive the merchant's language explicitly
 * (subscription welcome, trial lifecycle) instead of sniffing the content.
 */
function langPresentation(lang: 'ar' | 'en'): { rtl: boolean; dir: 'ltr' | 'rtl'; align: 'left' | 'right'; fontFamily: string } {
    const rtl = lang === 'ar';
    return {
        rtl,
        dir: rtl ? 'rtl' : 'ltr',
        align: rtl ? 'right' : 'left',
        fontFamily: rtl ? RTL_FONT_STACK : LTR_FONT_STACK,
    };
}

/** The standard body-`<td>` attributes shared by the text-first templates. */
function standardBodyCell(align: string, fontFamily: string): string {
    return ` class="pad ink" dir="auto" style="padding:24px 34px 30px 34px;color:#3d5155;font-size:16px;line-height:1.7;text-align:${align};font-family:${fontFamily};"`;
}

/**
 * The body's leading headline. Eight templates carried a byte-identical `<h1>`
 * string before this existed — the kind of clone a grep for a function name
 * never finds.
 */
function pageHeading(text: string, marginBottom: number = 14): string {
    return `<h1 class="ink" style="margin:0 0 ${marginBottom}px 0;font-size:25px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:#0b1f24;">${text}</h1>`;
}

/**
 * Primary CTA button block. The URL is HTML-escaped here; the label is the
 * caller's responsibility (usually a static i18n string, escaped only when it
 * carries untrusted input).
 */
function ctaButton(url: string, label: string, opts: { margin?: string; paddingX?: number } = {}): string {
    const { margin = '0 0 26px 0', paddingX = 28 } = opts;
    // A shrink-to-fit table rather than a bare inline-block anchor: Word-engine
    // Outlook drops `display:inline-block` and renders the padding as nothing,
    // while a `<td>` with a background colour it honours. It also needs no
    // alignment parameter — a shrink-to-fit table settles on the start edge, so
    // it follows the document's `dir` in both locales on its own.
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${margin};">
                <tr><td bgcolor="#0d9488" style="background-color:#0d9488;border-radius:8px;">
                  <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px ${paddingX}px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">${label}</a>
                </td></tr>
              </table>`;
}

/**
 * The "good to know" panel used by the lifecycle emails.
 *
 * Neutral ground with the brand colour spent only on the leading edge. It was
 * teal text on a teal ground inside a teal border, which put three values of
 * one hue in a box that exists to be read.
 */
function calloutPanel(rtl: boolean, html: string, marginBottom: 16 | 26 = 26): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${marginBottom}px 0;">
                <tr><td class="panel" style="background-color:#f5f8f8;border-${rtl ? 'right' : 'left'}:3px solid #0d9488;border-radius:6px;padding:14px 16px;color:#33474b;font-size:14.5px;line-height:1.6;">${html}</td></tr>
              </table>`;
}

/**
 * Origin for images embedded in email.
 *
 * Deliberately NOT `config.frontendUrl`: that points at localhost in dev and at
 * a staging host on staging, and an email outlives the environment that sent
 * it. A message opened next month must still resolve its logo, so the asset
 * host is fixed and the image is served from the marketing site.
 */
const EMAIL_ASSET_ORIGIN = process.env.EMAIL_ASSET_ORIGIN || 'https://jawab24.com';

/**
 * Dark-mode and small-screen rules for the shell.
 *
 * A `<style>` block is progressive enhancement here — Word-engine Outlook drops
 * it entirely, which is why every colour also exists inline. The classes only
 * ever OVERRIDE, so a client that ignores them still renders the light design
 * as authored rather than an unstyled one.
 */
const SHELL_STYLE = `<style>
  @media (prefers-color-scheme: dark) {
    .ground { background-color:#0a1214 !important; }
    .card { background-color:#111d1f !important; border-color:#223335 !important; }
    .ink, .ink h1 { color:#e6efef !important; }
    .soft { color:#9db2b1 !important; }
    .panel { background-color:#16262a !important; color:#c3d4d4 !important; }
    .rule { border-color:#223335 !important; }
    .foot, .foot a { color:#8fa4a3 !important; }
  }
  @media only screen and (max-width:600px) {
    .pad { padding:26px 22px !important; }
    .padtop { padding:24px 22px 0 22px !important; }
    .foot { padding:20px 22px 24px 22px !important; }
  }
</style>`;

/**
 * Shared branded email shell — the markup every transactional email has in
 * common: the document scaffold, the logo lockup, the centred 600/720px card,
 * and the footer. The parts that genuinely differ per email are passed in:
 *
 * - `lang` / `dir` / `bodyFontFamily` — content-driven (RTL) for most emails,
 *   fixed for the bilingual invite.
 * - `bodyCellAttrs` — the body `<td>` attributes, verbatim (templates differ in
 *   padding and whether they set dir/color/font on the cell vs. inner blocks).
 * - `headExtra` — extra `<head>` markup (the lead-digest responsive `<style>`).
 * - `maxWidth` — card width (600 default; the lead-digest table needs 720).
 * - `footerHtml` — footer inner content; defaults to the support/identity
 *   block. The waitlist email passes a custom footer carrying the unsubscribe
 *   link.
 *
 * `title` and the brand name are HTML-escaped here; `preheader`, `bodyHtml`,
 * `headExtra`, and `footerHtml` are caller-controlled markup (callers escape
 * any user-provided values before passing them in).
 */
function emailShell(opts: {
    lang: string;
    dir: 'ltr' | 'rtl';
    bodyFontFamily: string;
    title: string;
    preheader: string;
    headExtra?: string;
    maxWidth?: number;
    bodyCellAttrs: string;
    bodyHtml: string;
    footerHtml?: string;
}): string {
    const brandName = getBrandName();
    const maxWidth = opts.maxWidth ?? 600;
    const isArabic = opts.lang.startsWith('ar');
    const footerHtml = opts.footerHtml ?? defaultFooter(isArabic ? 'ar' : 'en');

    return `<!DOCTYPE html>
<html lang="${opts.lang}" dir="${opts.dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(opts.title)}</title>
  ${SHELL_STYLE}${opts.headExtra ? `\n${opts.headExtra}` : ''}
</head>
<body style="margin:0;padding:0;background-color:#f1f4f4;font-family:${opts.bodyFontFamily};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${opts.preheader}</div>
  <table role="presentation" class="ground" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f4f4;padding:36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" class="card" width="${maxWidth}" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #e3eaea;border-radius:10px;overflow:hidden;max-width:${maxWidth}px;width:100%;">
          <tr>
            <td class="padtop" style="padding:26px 34px 0 34px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="34" valign="middle" style="padding-inline-end:10px;"><img src="${EMAIL_ASSET_ORIGIN}/brand/logo-small.png" width="34" height="34" alt="" style="display:block;width:34px;height:34px;border:0;border-radius:8px;"></td>
                  <td valign="middle"><span class="ink" style="font-size:17px;font-weight:700;color:#0b1f24;letter-spacing:-0.01em;">${escapeHtml(brandName)}</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td${opts.bodyCellAttrs}>
              ${opts.bodyHtml}
            </td>
          </tr>
          <tr>
            <td class="rule" style="border-top:1px solid #e9eeee;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td class="foot" style="padding:20px 34px 24px 34px;text-align:${opts.dir === 'rtl' ? 'right' : 'left'};color:#728486;font-size:13px;line-height:1.65;">
              ${footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * The footer every email gets unless it passes its own. Three lines, because
 * one line reading "Jawab24 — jawab24.com" tells a merchant nothing it needs:
 * where to ask a question, who is writing, and how to stop.
 */
function defaultFooter(lang: 'ar' | 'en'): string {
    const brandName = escapeHtml(getBrandName());
    const settingsUrl = `${config.frontendUrl}/${lang}/settings`;
    // Whatever address is actually configured — the Reply-To if one is set,
    // otherwise the From. Never a hardcoded `support@`: a footer that names a
    // mailbox nobody created is a worse promise than the bare brand line it
    // replaced.
    const contact = config.resend.replyToEmail || config.resend.fromEmail;
    // No address configured → no contact line. A footer must never advertise a
    // mailbox that does not resolve, and one unrenderable line is not a reason
    // to fail the whole email.
    const contactLine = contact
        ? `<p style="margin:0 0 6px 0;">${t('emailFooterSupport', lang)} <a href="mailto:${escapeHtml(contact)}" style="color:#0d7a86;text-decoration:underline;">${escapeHtml(contact)}</a></p>\n              `
        : '';
    return `${contactLine}<p style="margin:0 0 6px 0;">${brandName} &middot; ${t('emailFooterIdentity', lang)}</p>
              <p style="margin:0;"><a href="${settingsUrl}" style="color:#728486;text-decoration:underline;">${t('emailFooterPreferences', lang)}</a></p>`;
}

/**
 * Generates a branded HTML email for waitlist campaigns.
 * Auto-detects RTL for Arabic content.
 * Includes per-recipient unsubscribe link (CAN-SPAM compliance).
 */
export function waitlistEmailTemplate(params: {
    subject: string;
    body: string;
    unsubscribeUrl: string;
    /**
     * Optional pre-rendered HTML email body. When provided, it is sent as-is
     * (no wrapping in the generic shell, no escaping, no preheader injection).
     * The only substitution is the {{UNSUBSCRIBE_URL}} placeholder.
     * Used by full-design custom templates (e.g. waitlist-launch).
     */
    customHtml?: string;
}): string {
    if (params.customHtml) {
        return params.customHtml.replace(/\{\{UNSUBSCRIBE_URL\}\}/g, params.unsubscribeUrl);
    }
    const htmlBody = escapeHtml(params.body).replace(/\n/g, '<br>');
    const { rtl, dir, lang, align, fontFamily } = rtlPresentation(params.body);
    const brandName = getBrandName();
    const unsubscribeLabel = rtl ? 'إلغاء الاشتراك' : 'Unsubscribe';

    return emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: params.subject,
        preheader: escapeHtml(params.body.slice(0, 150)),
        bodyCellAttrs: standardBodyCell(align, fontFamily),
        bodyHtml: htmlBody,
        footerHtml: `<p style="margin:0 0 8px 0;">${escapeHtml(brandName)} &mdash; jawab24.com</p>
              <p style="margin:0;">
                <a href="${params.unsubscribeUrl}" style="color:#71717a;text-decoration:underline;font-size:12px;">${unsubscribeLabel}</a>
              </p>`,
    });
}

/**
 * Account-notice email — an admin-composed message to a single merchant from
 * the support console (e.g. "your page disconnected", "Business Info is empty").
 * Transactional, NOT marketing: no unsubscribe link. Direction/language follow
 * the admin-written body (they may write Arabic or English regardless of the
 * merchant's dashboard language), so the greeting matches the body.
 *
 * `name` and `body` are HTML-escaped here — the admin's text is untrusted input.
 */
export function accountNoticeEmailTemplate(params: {
    name: string | null;
    subject: string;
    body: string;
}): { subject: string; html: string } {
    const { rtl, dir, lang, align, fontFamily } = rtlPresentation(params.body || params.subject);
    const trimmedName = params.name?.trim();
    const greeting = trimmedName
        ? (rtl ? `مرحبًا ${escapeHtml(trimmedName)}،` : `Hi ${escapeHtml(trimmedName)},`)
        : (rtl ? 'مرحبًا،' : 'Hi,');
    const bodyHtml = `<p style="margin:0 0 16px 0;">${greeting}</p>`
        + `<div>${escapeHtml(params.body).replace(/\n/g, '<br>')}</div>`;

    const html = emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: params.subject,
        // Array.from → slice by code point, so a 150-char cut can't split an
        // emoji surrogate pair into a replacement character.
        preheader: escapeHtml(Array.from(params.body).slice(0, 150).join('')),
        bodyCellAttrs: standardBodyCell(align, fontFamily),
        bodyHtml,
    });
    return { subject: params.subject, html };
}

/**
 * Subscription welcome email — sent once when a user's subscription becomes
 * active or trialing. Branded onboarding touchpoint; the legal/financial
 * receipt is sent separately by Stripe (VAT-compliant invoice with PDF).
 */
export function subscriptionWelcomeEmailTemplate(params: {
    lang: 'ar' | 'en';
    name: string;
    planName: string;
    dashboardUrl: string;
    trialEndsAt?: Date | null;
}): { subject: string; html: string } {
    const { lang, name, planName, dashboardUrl, trialEndsAt } = params;
    const { rtl, dir, align, fontFamily } = langPresentation(lang);

    // i18n strings come from JSON we control. User-provided values (name,
    // planName, trial date) are HTML-escaped before substitution so they're
    // safe when interpolated into the HTML below — which then escapes the
    // static template parts only via the final `${...}` interpolations not
    // wrapped in escapeHtml. Translations are static markup-free strings,
    // so a single substitution pass is enough.
    const escName = escapeHtml(name);
    const escPlan = escapeHtml(planName);
    const subject = t('subscriptionWelcomeSubject', lang, { plan: planName });
    const heading = t('subscriptionWelcomeHeading', lang);
    const intro = t('subscriptionWelcomeIntro', lang)
        .replace(/\{name\}/g, escName)
        .replace(/\{plan\}/g, escPlan);
    const nextSteps = t('subscriptionWelcomeNextSteps', lang);
    const billing = t('subscriptionWelcomeBilling', lang);
    const ctaLabel = t('subscriptionWelcomeCta', lang);
    const signoff = t('subscriptionWelcomeSignoff', lang);

    const trialBlock = trialEndsAt
        ? calloutPanel(rtl, t('subscriptionWelcomeTrialNote', lang).replace(/\{trialEnd\}/g, escapeHtml(formatDateTimeShort(trialEndsAt, lang))), 16)
        : '';

    const html = emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: subject,
        preheader: intro,
        bodyCellAttrs: standardBodyCell(align, fontFamily),
        bodyHtml: `${pageHeading(heading)}
              <p style="margin:0 0 16px 0;">${intro}</p>
              ${trialBlock}
              <p style="margin:0 0 24px 0;">${nextSteps}</p>
              ${ctaButton(dashboardUrl, ctaLabel)}
              <p style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${billing}</p>
              <p style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${signoff}</p>`,
    });

    return { subject, html };
}

/**
 * Trial-ending reminder — sent by the daily cron three days before
 * `subscriptions.trial_ends_at` (see services/trialReminders.ts).
 *
 * `trialEndLabel` arrives pre-formatted from the caller because the same label
 * is also used in the in-app notification body; formatting it once there keeps
 * the two channels from drifting apart.
 */
export function trialEndingEmailTemplate(params: {
    lang: 'ar' | 'en';
    name: string;
    trialEndLabel: string;
    pricingUrl: string;
}): { subject: string; html: string } {
    const { lang, name, trialEndLabel, pricingUrl } = params;
    const { rtl, dir, align, fontFamily } = langPresentation(lang);

    // Same escaping contract as the welcome email: translations are static,
    // markup-free strings we control; only the caller-supplied values are escaped.
    const escName = escapeHtml(name);
    const escTrialEnd = escapeHtml(trialEndLabel);

    const subject = t('trialEndingSubject', lang, { trialEnd: trialEndLabel });
    const heading = t('trialEndingHeading', lang);
    const intro = t('trialEndingIntro', lang)
        .replace(/\{name\}/g, escName)
        .replace(/\{trialEnd\}/g, escTrialEnd);
    const whatHappens = t('trialEndingWhatHappens', lang);
    const ctaLabel = t('trialEndingCta', lang);
    const signoff = t('trialEndingSignoff', lang);

    const html = emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: subject,
        preheader: intro,
        bodyCellAttrs: standardBodyCell(align, fontFamily),
        bodyHtml: `${pageHeading(heading)}
              <p style="margin:0 0 16px 0;">${intro}</p>
              ${calloutPanel(rtl, whatHappens)}
              ${ctaButton(pricingUrl, ctaLabel)}
              <p style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${signoff}</p>`,
    });

    return { subject, html };
}

/**
 * Trial-ended notice — the "last try" conversion email, sent by the same daily
 * cron once `trial_ends_at` has passed and the reply gate has closed (see
 * services/trialReminders.ts, runTrialEndedNotices).
 *
 * No date parameter on purpose: the fact that matters is that replies have
 * already stopped, not when the boundary was crossed.
 */
export function trialEndedEmailTemplate(params: {
    lang: 'ar' | 'en';
    name: string;
    pricingUrl: string;
}): { subject: string; html: string } {
    const { lang, name, pricingUrl } = params;
    const { rtl, dir, align, fontFamily } = langPresentation(lang);

    // Same escaping contract as the trial-ending email: translations are static,
    // markup-free strings we control; only the caller-supplied name is escaped.
    const escName = escapeHtml(name);

    const subject = t('trialEndedSubject', lang);
    const heading = t('trialEndedHeading', lang);
    const intro = t('trialEndedIntro', lang).replace(/\{name\}/g, escName);
    const whatRemains = t('trialEndedWhatRemains', lang);
    const ctaLabel = t('trialEndedCta', lang);
    const signoff = t('trialEndedSignoff', lang);

    const html = emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: subject,
        preheader: intro,
        bodyCellAttrs: standardBodyCell(align, fontFamily),
        bodyHtml: `${pageHeading(heading)}
              <p style="margin:0 0 16px 0;">${intro}</p>
              ${calloutPanel(rtl, whatRemains)}
              ${ctaButton(pricingUrl, ctaLabel)}
              <p style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${signoff}</p>`,
    });

    return { subject, html };
}

/**
 * Renewal-payment-failed dunning notice — fired by the invoice.payment_failed
 * webhook (and the daily dunning sweep as catch-up; see services/dunningNotices.ts)
 * the first time a subscription renewal charge is declined.
 *
 * `payUrl` is Stripe's hosted invoice page when available (no login, accepts a
 * different card) and falls back to the dashboard. `graceEndLabel` is null when
 * the row has no period end — the copy then degrades to "the next few days"
 * instead of printing a date we cannot stand behind (snapped-expiry lesson).
 */
export function paymentFailedEmailTemplate(params: {
    lang: 'ar' | 'en';
    name: string;
    amountLabel: string | null;
    graceEndLabel: string | null;
    payUrl: string;
}): { subject: string; html: string } {
    const { lang, name, amountLabel, graceEndLabel, payUrl } = params;
    const { rtl, dir, align, fontFamily } = langPresentation(lang);

    // Same escaping contract as the trial lifecycle emails: translations are
    // static, markup-free strings we control; caller-supplied values are escaped.
    const escName = escapeHtml(name);

    const subject = t('paymentFailedSubject', lang);
    const heading = t('paymentFailedHeading', lang);
    const intro = amountLabel
        ? t('paymentFailedIntro', lang)
            .replace(/\{name\}/g, escName)
            .replace(/\{amount\}/g, escapeHtml(amountLabel))
        : t('paymentFailedIntroNoAmount', lang).replace(/\{name\}/g, escName);
    const grace = graceEndLabel
        ? t('paymentFailedGrace', lang).replace(/\{graceEnd\}/g, escapeHtml(graceEndLabel))
        : t('paymentFailedGraceUnknown', lang);
    const updateCard = t('paymentFailedUpdateCard', lang);
    const ctaLabel = t('paymentFailedCta', lang);
    const signoff = t('paymentFailedSignoff', lang);

    const html = emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: subject,
        preheader: intro,
        bodyCellAttrs: standardBodyCell(align, fontFamily),
        bodyHtml: `${pageHeading(heading)}
              <p style="margin:0 0 16px 0;">${intro}</p>
              ${calloutPanel(rtl, grace)}
              ${ctaButton(payUrl, ctaLabel)}
              <p style="margin:0 0 16px 0;color:#52525b;font-size:14px;">${updateCard}</p>
              <p style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${signoff}</p>`,
    });

    return { subject, html };
}

/**
 * Service-suspended dunning notice — the moment the merchant actually loses
 * replies over an unpaid renewal: either Stripe gave up and canceled the
 * subscription (webhook), or the past_due grace window expired with no webhook
 * firing (daily sweep). See services/dunningNotices.ts for both triggers.
 *
 * `ctaVariant` picks the copy AND the destination: 'pay' when an open invoice
 * is still payable (hosted invoice page), 'resubscribe' when the subscription
 * is already canceled at Stripe and only a fresh checkout can revive it.
 */
export function serviceSuspendedEmailTemplate(params: {
    lang: 'ar' | 'en';
    name: string;
    stoppedSinceLabel: string;
    ctaUrl: string;
    ctaVariant: 'pay' | 'resubscribe';
}): { subject: string; html: string } {
    const { lang, name, stoppedSinceLabel, ctaUrl, ctaVariant } = params;
    const { rtl, dir, align, fontFamily } = langPresentation(lang);

    const escName = escapeHtml(name);

    const subject = t('serviceSuspendedSubject', lang);
    const heading = t('serviceSuspendedHeading', lang);
    const intro = t('serviceSuspendedIntro', lang)
        .replace(/\{name\}/g, escName)
        .replace(/\{stoppedSince\}/g, escapeHtml(stoppedSinceLabel));
    const whatRemains = t('serviceSuspendedWhatRemains', lang);
    const ctaLabel = t(ctaVariant === 'pay' ? 'serviceSuspendedCtaPay' : 'serviceSuspendedCtaResubscribe', lang);
    const signoff = t('serviceSuspendedSignoff', lang);

    const html = emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: subject,
        preheader: intro,
        bodyCellAttrs: standardBodyCell(align, fontFamily),
        bodyHtml: `${pageHeading(heading)}
              <p style="margin:0 0 16px 0;">${intro}</p>
              ${calloutPanel(rtl, whatRemains)}
              ${ctaButton(ctaUrl, ctaLabel)}
              <p style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${signoff}</p>`,
    });

    return { subject, html };
}

/**
 * Payment-recovered confirmation — closes the dunning loop. Sent ONLY when a
 * failure episode was open (the merchant received a payment-failed or
 * suspension email); a normal renewal never triggers it. See
 * services/dunningNotices.ts, handlePaymentRecovery.
 */
export function paymentRecoveredEmailTemplate(params: {
    lang: 'ar' | 'en';
    name: string;
    periodEndLabel: string;
    dashboardUrl: string;
}): { subject: string; html: string } {
    const { lang, name, periodEndLabel, dashboardUrl } = params;
    const { dir, align, fontFamily } = langPresentation(lang);

    const escName = escapeHtml(name);

    const subject = t('paymentRecoveredSubject', lang);
    const heading = t('paymentRecoveredHeading', lang);
    const intro = t('paymentRecoveredIntro', lang)
        .replace(/\{name\}/g, escName)
        .replace(/\{periodEnd\}/g, escapeHtml(periodEndLabel));
    const ctaLabel = t('paymentRecoveredCta', lang);
    const signoff = t('paymentRecoveredSignoff', lang);

    const html = emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: subject,
        preheader: intro,
        bodyCellAttrs: standardBodyCell(align, fontFamily),
        bodyHtml: `${pageHeading(heading)}
              <p style="margin:0 0 16px 0;">${intro}</p>
              ${ctaButton(dashboardUrl, ctaLabel)}
              <p style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${signoff}</p>`,
    });

    return { subject, html };
}

/**
 * Send-failure auto-pause notice — fired the moment services/pageAutoPause.ts
 * pauses a page after PAUSE_THRESHOLD consecutive rejected sends. The page has
 * gone silent and only a human re-enable brings it back, so this is the one
 * email whose absence directly costs the merchant customers.
 *
 * The copy leads with the two-step fix (reconnect, then re-enable) and states
 * explicitly that a Facebook login/logout is NOT enough — the exact
 * misunderstanding that kept a real page dead for a whole evening (2026-08-10).
 */
export function autoPausedEmailTemplate(params: {
    lang: 'ar' | 'en';
    pageName: string;
    dashboardUrl: string;
}): { subject: string; html: string } {
    const { lang, pageName, dashboardUrl } = params;
    const { rtl, dir, align, fontFamily } = langPresentation(lang);

    // Same escaping contract as the trial lifecycle emails: translations are
    // static, markup-free strings we control; the page name is merchant data.
    const escPageName = escapeHtml(pageName);

    const subject = t('autoPausedSubject', lang, { pageName });
    const heading = t('autoPausedHeading', lang);
    const intro = t('autoPausedIntro', lang).replace(/\{pageName\}/g, escPageName);
    const fixSteps = t('autoPausedFixSteps', lang);
    const passwordNote = t('autoPausedPasswordNote', lang);
    const ctaLabel = t('autoPausedCta', lang);
    const signoff = t('autoPausedSignoff', lang);

    const html = emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: subject,
        preheader: intro,
        bodyCellAttrs: standardBodyCell(align, fontFamily),
        bodyHtml: `${pageHeading(heading)}
              <p style="margin:0 0 16px 0;">${intro}</p>
              <p style="margin:0 0 16px 0;">${fixSteps}</p>
              ${calloutPanel(rtl, passwordNote)}
              ${ctaButton(dashboardUrl, ctaLabel)}
              <p style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${signoff}</p>`,
    });

    return { subject, html };
}

/**
 * Page-reconnect notice — fired by services/pageTokenRecovery.ts the first time a
 * live Graph call proves the page credential is gone AND re-minting it from
 * /me/accounts failed (i.e. the merchant's own Facebook session ended).
 *
 * Distinct from `autoPausedEmailTemplate` on purpose, and both can be right:
 * that one fires after ten rejected sends and asks for two steps (reconnect,
 * then re-enable). This one fires on the FIRST rejection, before any customer
 * has been lost, and names the actual cause — the sentence that turns "Jawab24
 * is broken" into "I changed my password".
 */
export function pageReconnectEmailTemplate(params: {
    lang: 'ar' | 'en';
    pageName: string;
    cause: 'password_changed' | 'logged_out' | 'security_checkpoint' | 'token_expired' | 'permissions_revoked' | 'unknown';
    dashboardUrl: string;
}): { subject: string; html: string } {
    const { lang, pageName, cause, dashboardUrl } = params;
    const { rtl, dir, align, fontFamily } = langPresentation(lang);

    // Same escaping contract as the other lifecycle emails: our translations are
    // static markup-free strings; the page name is merchant data.
    const escPageName = escapeHtml(pageName);

    const causeKey = {
        password_changed:    'pageReconnectCausePasswordChanged',
        logged_out:          'pageReconnectCauseLoggedOut',
        security_checkpoint: 'pageReconnectCauseSecurityCheckpoint',
        token_expired:       'pageReconnectCauseTokenExpired',
        permissions_revoked: 'pageReconnectCausePermissionsRevoked',
        unknown:             'pageReconnectCauseUnknown',
    } as const;

    const subject = t('pageReconnectSubject', lang, { pageName });
    const heading = t('pageReconnectHeading', lang);
    const intro = t(causeKey[cause], lang).replace(/\{pageName\}/g, escPageName);
    const impact = t('pageReconnectImpact', lang);
    const fixSteps = t('pageReconnectFixSteps', lang);
    const passwordNote = t('pageReconnectPasswordNote', lang);
    const ctaLabel = t('pageReconnectCta', lang);
    const signoff = t('pageReconnectSignoff', lang);

    const html = emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: subject,
        preheader: intro,
        bodyCellAttrs: standardBodyCell(align, fontFamily),
        bodyHtml: `${pageHeading(heading)}
              <p style="margin:0 0 16px 0;">${intro} ${impact}</p>
              <p style="margin:0 0 16px 0;">${fixSteps}</p>
              ${calloutPanel(rtl, passwordNote)}
              ${ctaButton(dashboardUrl, ctaLabel)}
              <p style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${signoff}</p>`,
    });

    return { subject, html };
}

/**
 * Team invite email — sent when an owner/admin invites someone by email.
 *
 * Bilingual by design: the recipient may not have an account yet, so their
 * preferred language is unknown. We render both an Arabic block and an English
 * block in a single email so either audience can act on it. The CTA link and
 * accept flow are identical to the SMS invite path.
 */
export function inviteEmailTemplate(params: {
    workspaceName: string;
    inviteUrl: string;
}): { subject: string; html: string } {
    const { workspaceName, inviteUrl } = params;
    const escWorkspace = escapeHtml(workspaceName);
    const arFont = "'Cairo','Tajawal',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
    const enFont = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

    // i18n strings are static markup-free strings we control; {workspace} is the
    // only interpolated value — HTML-escaped, then substituted via t()'s vars
    // (t uses a literal replacer, so `$` chars in a workspace name stay intact).
    const intro = (lang: 'ar' | 'en') => t('inviteEmailIntro', lang, { workspace: escWorkspace });
    const subject = `${t('inviteEmailSubject', 'ar', { workspace: workspaceName })} | ${t('inviteEmailSubject', 'en', { workspace: workspaceName })}`;

    // One CTA button serves both languages (same link); the label is bilingual.
    const ctaLabel = `${t('inviteEmailCta', 'ar')} · ${t('inviteEmailCta', 'en')}`;

    const block = (lang: 'ar' | 'en') => {
        const rtl = lang === 'ar';
        const align = rtl ? 'right' : 'left';
        const font = rtl ? arFont : enFont;
        return `<div dir="${rtl ? 'rtl' : 'ltr'}" style="text-align:${align};font-family:${font};">
                ${pageHeading(t('inviteEmailHeading', lang), 12)}
                <p style="margin:0 0 8px 0;color:#18181b;font-size:16px;line-height:1.6;">${intro(lang)}</p>
                <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5;">${t('inviteEmailExpiry', lang)}</p>
              </div>`;
    };

    const html = emailShell({
        lang: 'ar',
        dir: 'rtl',
        bodyFontFamily: enFont,
        title: t('inviteEmailSubject', 'en', { workspace: workspaceName }),
        preheader: intro('en'),
        bodyCellAttrs: ` style="padding:32px;"`,
        bodyHtml: `${block('ar')}
              <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;">
              ${block('en')}
              ${ctaButton(inviteUrl, ctaLabel, { margin: '28px 0 0 0', paddingX: 28 })}
              <p style="margin:20px 0 0 0;color:#a1a1aa;font-size:12px;line-height:1.5;text-align:center;">
                ${t('inviteEmailIgnore', 'ar')}<br>${t('inviteEmailIgnore', 'en')}
              </p>`,
    });

    return { subject, html };
}

/**
 * Lead digest email — sent once per day to the workspace owner when they
 * have 10+ new (non-emailed) leads. Lists up to MAX_ROWS leads in a table
 * with an "and N more" line if truncated.
 */
export interface LeadDigestRow {
    name: string | null;
    phone: string;
    sourceType: 'message' | 'comment' | string;
    createdAt: Date;
    summary?: string | null;
}

const DIGEST_MAX_ROWS = 20;

export function leadDigestEmailTemplate(params: {
    lang: 'ar' | 'en';
    leadCount: number;
    leads: LeadDigestRow[];
    dashboardUrl: string;
}): { subject: string; html: string } {
    const lang = params.lang === 'ar' ? 'ar' : 'en';
    const rtl = lang === 'ar';
    const dir = rtl ? 'rtl' : 'ltr';
    const align = rtl ? 'right' : 'left';
    const fontFamily = rtl
        ? "'Cairo','Tajawal',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        : "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

    // Plural-aware: the digest can now fire on a single waiting lead (age flush),
    // so "1 new leads" / «لديك 1 عميل» is reachable copy, not a hypothetical.
    const subject = tPlural('leadDigestSubject', params.leadCount, lang);
    const heading = t('leadDigestHeading', lang);
    const intro = tPlural('leadDigestIntro', params.leadCount, lang);
    const cta = t('leadDigestCta', lang);
    const thName = t('leadDigestTableName', lang);
    const thPhone = t('leadDigestTablePhone', lang);
    const thReason = t('leadDigestTableReason', lang);
    const thSource = t('leadDigestTableSource', lang);
    const thDate = t('leadDigestTableDate', lang);
    const srcMsg = t('leadDigestSourceMessage', lang);
    const srcCmt = t('leadDigestSourceComment', lang);
    const noSummary = t('leadDigestNoSummary', lang);

    const rows = params.leads.slice(0, DIGEST_MAX_ROWS);
    const remaining = Math.max(0, params.leadCount - rows.length);

    const lblName = escapeHtml(thName);
    const lblPhone = escapeHtml(thPhone);
    const lblReason = escapeHtml(thReason);
    const lblSource = escapeHtml(thSource);
    const lblDate = escapeHtml(thDate);
    const mobileLabel = (label: string) =>
        `<span class="ld-mlabel" style="display:none;font-weight:600;color:#71717a;font-size:12px;margin-${rtl ? 'left' : 'right'}:8px;">${label}:</span>`;

    const tableRows = rows.map(lead => {
        const name = escapeHtml(lead.name?.trim() || '—');
        const phone = escapeHtml(lead.phone);
        const reason = escapeHtml(lead.summary?.trim() || noSummary);
        const source = escapeHtml(lead.sourceType === 'comment' ? srcCmt : srcMsg);
        const date = escapeHtml(formatDateTimeShort(lead.createdAt, lang));
        return `<tr class="ld-row">
          <td class="ld-cell" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;vertical-align:top;word-break:break-word;">${mobileLabel(lblName)}${name}</td>
          <td class="ld-cell" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;vertical-align:top;" dir="ltr">${mobileLabel(lblPhone)}${phone}</td>
          <td class="ld-cell" dir="auto" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#3f3f46;vertical-align:top;line-height:1.5;word-break:break-word;">${mobileLabel(lblReason)}${reason}</td>
          <td class="ld-cell" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#52525b;vertical-align:top;">${mobileLabel(lblSource)}${source}</td>
          <td class="ld-cell ld-cell-last" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#52525b;vertical-align:top;white-space:nowrap;">${mobileLabel(lblDate)}${date}</td>
        </tr>`;
    }).join('');

    const andMore = remaining > 0
        ? `<p style="margin:16px 0 0 0;color:#71717a;font-size:14px;">${escapeHtml(t('leadDigestAndMore', lang, { count: String(remaining) }))}</p>`
        : '';

    const headExtra = `  <style>
    @media only screen and (max-width: 600px) {
      .ld-table { table-layout: auto !important; }
      .ld-thead { display: none !important; }
      .ld-row { display: block !important; width: 100% !important; padding: 12px 4px !important; border-bottom: 1px solid #e4e4e7 !important; }
      .ld-cell { display: block !important; width: 100% !important; padding: 4px 8px !important; border-bottom: none !important; white-space: normal !important; }
      .ld-mlabel { display: inline !important; }
    }
  </style>`;

    return {
        subject,
        html: emailShell({
            lang,
            dir,
            bodyFontFamily: fontFamily,
            title: subject,
            preheader: escapeHtml(intro),
            headExtra,
            maxWidth: 720,
            bodyCellAttrs: ` style="padding:28px 24px;color:#18181b;font-size:16px;line-height:1.6;text-align:${align};font-family:${fontFamily};"`,
            bodyHtml: `${pageHeading(escapeHtml(heading), 8)}
              <p style="margin:0 0 20px 0;color:#3f3f46;">${escapeHtml(intro)}</p>
              <table class="ld-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;table-layout:fixed;">
                <colgroup>
                  <col style="width:18%;">
                  <col style="width:18%;">
                  <col style="width:36%;">
                  <col style="width:12%;">
                  <col style="width:16%;">
                </colgroup>
                <thead class="ld-thead">
                  <tr style="background-color:#fafafa;">
                    <th align="${align}" style="padding:10px 12px;border-bottom:2px solid #e4e4e7;font-size:13px;color:#71717a;font-weight:600;">${escapeHtml(thName)}</th>
                    <th align="${align}" style="padding:10px 12px;border-bottom:2px solid #e4e4e7;font-size:13px;color:#71717a;font-weight:600;">${escapeHtml(thPhone)}</th>
                    <th align="${align}" style="padding:10px 12px;border-bottom:2px solid #e4e4e7;font-size:13px;color:#71717a;font-weight:600;">${escapeHtml(thReason)}</th>
                    <th align="${align}" style="padding:10px 12px;border-bottom:2px solid #e4e4e7;font-size:13px;color:#71717a;font-weight:600;">${escapeHtml(thSource)}</th>
                    <th align="${align}" style="padding:10px 12px;border-bottom:2px solid #e4e4e7;font-size:13px;color:#71717a;font-weight:600;">${escapeHtml(thDate)}</th>
                  </tr>
                </thead>
                <tbody>${tableRows}</tbody>
              </table>
              ${andMore}
              ${ctaButton(params.dashboardUrl, escapeHtml(cta), { margin: '28px 0 0 0', paddingX: 28 })}`,
        }),
    };
}
