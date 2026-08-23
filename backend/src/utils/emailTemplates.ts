import { config } from '../config';
import { t, tPlural } from './i18n';
import { escapeHtml } from './htmlUtils';
import { formatDateTimeShort, formatCount } from './formatDate';

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
 * The closing line. Carries `.soft` so the dark block can reach it — the muted
 * layer was declared in the stylesheet and applied to nothing, which left every
 * sign-off at 2.23:1 in dark mode.
 */
function signoffLine(text: string): string {
    return `<p class="soft" style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${text}</p>`;
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
                <tr><td class="cta" bgcolor="#0d9488" style="background-color:#0d9488;border-radius:8px;">
                  <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px ${paddingX}px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">${label}</a>
                </td></tr>
              </table>`;
}

/**
 * Secondary action, paired with `ctaButton` when an email has two destinations
 * and one of them is clearly the point. An outline rather than a second filled
 * button: two teal blocks read as equals and the merchant has to stop and
 * choose, which is the opposite of what a one-lead digest wants.
 *
 * Same shrink-to-fit table as the primary for the Outlook reason documented
 * there. The border is drawn on the `<td>`, not the `<a>` — Word-engine Outlook
 * ignores a border on an inline-block anchor.
 */
function secondaryButton(url: string, label: string, opts: { margin?: string; paddingX?: number } = {}): string {
    const { margin = '0', paddingX = 24 } = opts;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${margin};">
                <tr><td class="ghost" style="background-color:#ffffff;border:1px solid #cfdcdc;border-radius:8px;">
                  <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px ${paddingX}px;color:#33474b;text-decoration:none;font-weight:600;font-size:14.5px;">${label}</a>
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
    body, .ground { background-color:#0a1214 !important; }
    .card { background-color:#111d1f !important; border-color:#223335 !important; }
    /*
     * Reach DESCENDANTS, not just the cells the shell owns. A class on the body
     * cell recolours that cell; it does not touch a child that declares its own
     * inline \`color:\`, and most of the copy does. The first version of this
     * block styled only the scaffold, so the card went dark while the lead rows
     * and the whole invite body stayed #18181b — 1.03:1, invisible. An author
     * !important beats a non-important inline style, which is what makes this
     * work at all.
     */
    .card td, .card th, .card p, .card h1, .card span, .card div, .card strong, .card b, .card a { color:#e6efef !important; }
    /* Everything below re-asserts AFTER the sweep above; equal specificity, so
     * source order decides. Moving any of these up silently disables it. */
    .soft, .soft p { color:#9db2b1 !important; }
    .panel, .panel td { background-color:#16262a !important; color:#c3d4d4 !important; }
    .rule, .ld-cell, .ld-row, .card th { border-color:#223335 !important; }
    /* The digest header is thead.ld-head > tr[style=background:#fafafa] > th.
     * Naming only the thead and td here left that inline #fafafa on the tr
     * standing, while the .card th sweep above had already turned the labels
     * #e6efef — a white bar with invisible text. Every element that can paint
     * a background in this subtree must be named. */
    .ld-head, .ld-head tr, .ld-head th, .ld-head td { background-color:#0d1719 !important; }
    /* Both of these paint a background, so they must re-assert it here for the
     * same reason .ld-head does — the .card td sweep only recolours text, but a
     * white/near-white ground left standing under recoloured text is the
     * white-bar bug in a different place. */
    .ghost, .ghost td { background-color:#16262a !important; border-color:#2c4145 !important; }
    .ghost a { color:#c3d4d4 !important; }
    .pill, .pill td { background-color:#3a2a12 !important; }
    .pill, .pill td, .pill span { color:#f0c274 !important; }
    .foot, .foot p, .foot td { color:#8fa4a3 !important; }
    .foot a { color:#8fa4a3 !important; }
    .cta, .cta a { color:#ffffff !important; }
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
    const footerHtml = opts.footerHtml ?? defaultFooter([isArabic ? 'ar' : 'en']);

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
<body class="ground" style="margin:0;padding:0;background-color:#f1f4f4;font-family:${opts.bodyFontFamily};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${opts.preheader}</div>
  <table role="presentation" class="ground" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f4f4;padding:36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" class="card" width="${maxWidth}" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #e3eaea;border-radius:10px;overflow:hidden;max-width:${maxWidth}px;width:100%;">
          <tr>
            <td class="padtop" style="padding:26px 34px 0 34px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="34" valign="middle" style="padding-${opts.dir === 'rtl' ? 'left' : 'right'}:10px;"><img src="${EMAIL_ASSET_ORIGIN}/brand/logo-small.png" width="34" height="34" alt="" style="display:block;width:34px;height:34px;border:0;border-radius:8px;"></td>
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
 * The footer every email gets unless it passes its own. Three lines, because one
 * line reading "Jawab24 — jawab24.com" tells a merchant nothing it needs: who to
 * ask, who is writing, and where to change what they receive.
 *
 * Takes a LIST of languages, not one. The invite renders both languages in its
 * body and only sets `lang: 'ar'` to pick a layout direction — inferring the
 * footer's language from that gave a deliberately bilingual email an
 * Arabic-only footer, which is a regression against the language-neutral line
 * it replaced.
 *
 * `preferences` is off for recipients who have no account to manage: the link is
 * auth-gated, so pointing an invitee at it lands them on a login wall from the
 * email inviting them to sign up.
 *
 * The contact line names the address WITHOUT inviting a reply. That is
 * deliberate — `.claude/commands/merchant-email.md` carries a standing ruling
 * against asking a merchant to write back, and this footer renders on
 * `account_notice`, which is that skill's own send path.
 */
function defaultFooter(langs: Array<'ar' | 'en'>, opts: { preferences?: boolean } = {}): string {
    const { preferences = true } = opts;
    const brandName = escapeHtml(getBrandName());
    // `fromEmail` carries a hardcoded default in config, so this is never empty.
    // An earlier version guarded for that and shipped a branch no production
    // config could reach, plus a test that "covered" it by assigning a state the
    // real module cannot produce. Resolve, do not pretend to fall back.
    const contact = escapeHtml(config.resend.replyToEmail || config.resend.fromEmail);

    const lines = langs.map((lang) =>
        `<p style="margin:0 0 6px 0;">${t('emailFooterSupport', lang)} <a href="mailto:${contact}" style="color:#0d7a86;text-decoration:underline;">${contact}</a></p>`);

    lines.push(`<p style="margin:0 0 6px 0;">${brandName} &middot; ${langs.map((l) => t('emailFooterIdentity', l)).join(' &middot; ')}</p>`);

    if (preferences) {
        const lang = langs[0];
        const settingsUrl = `${config.frontendUrl}/${lang}/settings`;
        lines.push(`<p style="margin:0;"><a href="${settingsUrl}" style="color:#728486;text-decoration:underline;">${t('emailFooterPreferences', lang)}</a></p>`);
    }

    return lines.join('\n              ');
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
              ${signoffLine(signoff)}`,
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
              ${signoffLine(signoff)}`,
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
              ${signoffLine(signoff)}`,
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
              ${signoffLine(signoff)}`,
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
              ${signoffLine(signoff)}`,
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
              ${signoffLine(signoff)}`,
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
              ${signoffLine(signoff)}`,
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
              ${signoffLine(signoff)}`,
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
        footerHtml: defaultFooter(['ar', 'en'], { preferences: false }),
        title: t('inviteEmailSubject', 'en', { workspace: workspaceName }),
        preheader: intro('en'),
        bodyCellAttrs: ` class="pad ink" style="padding:32px;"`,
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

/** One digest row's display strings, HTML-escaped once for both layouts. */
interface LeadDigestCells {
    name: string;
    phone: string;
    /** `+` and digits only — what a `tel:` href can actually dial. */
    telHref: string;
    reason: string;
    source: string;
    date: string;
}

const DIGEST_FIELD_LABELS = ['leadDigestTableName', 'leadDigestTablePhone', 'leadDigestTableReason', 'leadDigestTableSource', 'leadDigestTableDate'] as const;

interface LeadDigestLayout {
    bodyHtml: string;
    headExtra?: string;
    maxWidth: number;
}

/**
 * The multi-lead layout: a five-column table in a 720px card, collapsing to
 * stacked label/value cells under 600px via the `ld-*` responsive rules.
 */
function leadDigestTable(rows: LeadDigestCells[], labels: string[], rtl: boolean): LeadDigestLayout {
    const align = rtl ? 'right' : 'left';
    const mobileLabel = (label: string) =>
        `<span class="ld-mlabel" style="display:none;font-weight:600;color:#71717a;font-size:12px;margin-${rtl ? 'left' : 'right'}:8px;">${label}:</span>`;
    const [lblName, lblPhone, lblReason, lblSource, lblDate] = labels;

    const tableRows = rows.map(lead => `<tr class="ld-row">
          <td class="ld-cell" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;vertical-align:top;word-break:break-word;">${mobileLabel(lblName)}${lead.name}</td>
          <td class="ld-cell" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;vertical-align:top;" dir="ltr">${mobileLabel(lblPhone)}${lead.phone}</td>
          <td class="ld-cell" dir="auto" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#3f3f46;vertical-align:top;line-height:1.5;word-break:break-word;">${mobileLabel(lblReason)}${lead.reason}</td>
          <td class="ld-cell" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#52525b;vertical-align:top;">${mobileLabel(lblSource)}${lead.source}</td>
          <td class="ld-cell ld-cell-last" style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#52525b;vertical-align:top;white-space:nowrap;">${mobileLabel(lblDate)}${lead.date}</td>
        </tr>`).join('');

    const th = (label: string) =>
        `<th align="${align}" style="padding:10px 12px;border-bottom:2px solid #e4e4e7;font-size:13px;color:#71717a;font-weight:600;">${label}</th>`;

    return {
        maxWidth: 720,
        headExtra: `  <style>
    @media only screen and (max-width: 600px) {
      .ld-table { table-layout: auto !important; }
      .ld-thead { display: none !important; }
      .ld-row { display: block !important; width: 100% !important; padding: 12px 4px !important; border-bottom: 1px solid #e4e4e7 !important; }
      .ld-cell { display: block !important; width: 100% !important; padding: 4px 8px !important; border-bottom: none !important; white-space: normal !important; }
      .ld-mlabel { display: inline !important; }
    }
  </style>`,
        bodyHtml: `<table class="ld-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;table-layout:fixed;">
                <colgroup>
                  <col style="width:18%;">
                  <col style="width:18%;">
                  <col style="width:36%;">
                  <col style="width:12%;">
                  <col style="width:16%;">
                </colgroup>
                <thead class="ld-thead ld-head">
                  <tr style="background-color:#fafafa;">
                    ${labels.map(th).join('\n                    ')}
                  </tr>
                </thead>
                <tbody>${tableRows}</tbody>
              </table>`,
    };
}

/**
 * The single-lead layout. The age flush (see `leadDigest.ts`) sends the digest
 * for ONE waiting lead, and the five-column `table-layout:fixed` grid is the
 * wrong tool for that: at 720px the reason column wraps to three lines and
 * the date clips at the card edge. One lead reads as a card — label over
 * value, full width — in the standard 600px shell. Same five labels as the
 * table, so the two layouts never drift in vocabulary.
 */
function leadDigestSingleLead(lead: LeadDigestCells, labels: string[], rtl: boolean, waitingPill: string): LeadDigestLayout {
    // The phone is the one field a merchant acts on, so it is the only value
    // rendered as a link and it is repeated as the primary button below. Kept
    // in Latin digits and stripped to `+` and digits in the href — an
    // Arabic-Indic numeral is not dialable.
    const phoneLink = `<a href="tel:${escapeHtml(lead.telHref)}" dir="ltr" style="color:#0d7a86;text-decoration:none;font-weight:600;">${lead.phone}</a>`;
    const values = [lead.name, phoneLink, lead.reason, lead.source, lead.date];

    const fieldRows = labels.map((label, i) => `<tr>
                  <td style="padding:${i === 0 ? 0 : 12}px 0 0 0;">
                    <span class="soft" style="display:block;font-size:12.5px;font-weight:600;color:#52525b;margin:0 0 3px 0;">${label}</span>
                    <span${i === 2 ? ' dir="auto"' : ''} style="display:block;font-size:15px;line-height:1.55;color:#18181b;word-break:break-word;">${values[i]}</span>
                  </td>
                </tr>`).join('');

    return {
        maxWidth: 600,
        bodyHtml: `${waitingPill}${calloutPanel(rtl, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${fieldRows}
              </table>`, 16)}`,
    };
}

/**
 * "Waiting 3 hours" — the fact the email exists to convey.
 *
 * A bare timestamp makes the reader do the subtraction, and the digest's whole
 * premise is that this customer has been waiting too long. Hours up to a day,
 * then days.
 *
 * Under an hour takes its OWN key rather than a `_zero` plural variant:
 * `Intl.PluralRules('en').select(0)` returns `other`, never `zero`, so the
 * variant is unreachable in English and the pill read "Waiting 0 hours".
 *
 * Amber, not red: the lead is going cold, not lost, and a red email about a
 * customer who did nothing wrong overstates it.
 */
function leadDigestWaitingPill(createdAt: Date, now: Date, lang: 'ar' | 'en'): string {
    const hours = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 3_600_000));
    const useDays = hours >= 24;
    const count = useDays ? Math.floor(hours / 24) : hours;
    const text = hours < 1
        ? t('leadDigestWaitingUnderHour', lang)
        : tPlural(
            useDays ? 'leadDigestWaitingDays' : 'leadDigestWaitingHours',
            count,
            lang,
            { count: formatCount(count, lang) },
        );

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;">
                <tr><td class="pill" bgcolor="#fdf3e3" style="background-color:#fdf3e3;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:#8a5a12;">
                  <span style="color:#8a5a12;">${escapeHtml(text)}</span>
                </td></tr>
              </table>`;
}

export function leadDigestEmailTemplate(params: {
    lang: 'ar' | 'en';
    leadCount: number;
    leads: LeadDigestRow[];
    dashboardUrl: string;
    /** Injected by tests so the waiting pill is not wall-clock dependent. */
    now?: Date;
}): { subject: string; html: string } {
    const lang = params.lang === 'ar' ? 'ar' : 'en';
    const { rtl, dir, align, fontFamily } = langPresentation(lang);

    // Plural-aware: the digest can now fire on a single waiting lead (age flush),
    // so "1 new leads" / «لديك 1 عميل» is reachable copy, not a hypothetical.
    const subject = tPlural('leadDigestSubject', params.leadCount, lang);
    const heading = t('leadDigestHeading', lang);
    const intro = tPlural('leadDigestIntro', params.leadCount, lang);
    const cta = t('leadDigestCta', lang);
    const srcMsg = t('leadDigestSourceMessage', lang);
    const srcCmt = t('leadDigestSourceComment', lang);
    const noSummary = t('leadDigestNoSummary', lang);
    const labels = DIGEST_FIELD_LABELS.map(key => escapeHtml(t(key, lang)));

    const rows = params.leads.slice(0, DIGEST_MAX_ROWS);
    const remaining = Math.max(0, params.leadCount - rows.length);

    const cells: LeadDigestCells[] = rows.map(lead => ({
        name: escapeHtml(lead.name?.trim() || '—'),
        phone: escapeHtml(lead.phone),
        telHref: lead.phone.replace(/[^\d+]/g, ''),
        reason: escapeHtml(lead.summary?.trim() || noSummary),
        source: escapeHtml(lead.sourceType === 'comment' ? srcCmt : srcMsg),
        date: escapeHtml(formatDateTimeShort(lead.createdAt, lang)),
    }));

    const single = cells.length === 1;
    const layout = single
        ? leadDigestSingleLead(cells[0], labels, rtl, leadDigestWaitingPill(rows[0].createdAt, params.now ?? new Date(), lang))
        : leadDigestTable(cells, labels, rtl);

    // One lead: the action is to phone that person, so the dashboard becomes the
    // secondary destination. Many leads: there is no single number to call, and
    // the dashboard is the only sensible action — so it stays primary and the
    // email keeps exactly one button.
    const actions = single
        ? `${ctaButton(`tel:${cells[0].telHref}`, escapeHtml(t('leadDigestCallNow', lang, { phone: cells[0].telHref })), { margin: '24px 0 10px 0', paddingX: 26 })}
              ${secondaryButton(params.dashboardUrl, escapeHtml(t('leadDigestOpenDashboard', lang)))}`
        : ctaButton(params.dashboardUrl, escapeHtml(cta), { margin: '28px 0 0 0', paddingX: 28 });

    const andMore = remaining > 0
        ? `<p style="margin:16px 0 0 0;color:#71717a;font-size:14px;">${escapeHtml(t('leadDigestAndMore', lang, { count: formatCount(remaining, lang) }))}</p>`
        : '';

    return {
        subject,
        html: emailShell({
            lang,
            dir,
            bodyFontFamily: fontFamily,
            title: subject,
            preheader: escapeHtml(intro),
            headExtra: layout.headExtra,
            maxWidth: layout.maxWidth,
            bodyCellAttrs: ` class="pad ink" style="padding:28px 24px;color:#18181b;font-size:16px;line-height:1.6;text-align:${align};font-family:${fontFamily};"`,
            bodyHtml: `${pageHeading(escapeHtml(heading), 8)}
              <p style="margin:0 0 20px 0;color:#3f3f46;">${escapeHtml(intro)}</p>
              ${layout.bodyHtml}
              ${andMore}
              ${actions}`,
        }),
    };
}
