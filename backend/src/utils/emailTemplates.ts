import { config } from '../config';
import { t } from './i18n';

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

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

/**
 * Shared branded email shell — the markup every transactional email has in
 * common: the document scaffold, a teal brand header, the centered 600/720px
 * card, and a footer. The parts that genuinely differ per email are passed in:
 *
 * - `lang` / `dir` / `bodyFontFamily` — content-driven (RTL) for most emails,
 *   fixed for the bilingual invite.
 * - `bodyCellAttrs` — the body `<td>` attributes, verbatim (templates differ in
 *   padding and whether they set dir/color/font on the cell vs. inner blocks).
 * - `headExtra` — extra `<head>` markup (the lead-digest responsive `<style>`).
 * - `maxWidth` — card width (600 default; the lead-digest table needs 720).
 * - `footerHtml` — footer inner content; defaults to the brand line. The
 *   waitlist email passes a custom footer carrying the unsubscribe link.
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
    const footerHtml = opts.footerHtml ?? `<p style="margin:0;">${escapeHtml(brandName)} &mdash; jawab24.com</p>`;

    return `<!DOCTYPE html>
<html lang="${opts.lang}" dir="${opts.dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(opts.title)}</title>${opts.headExtra ? `\n${opts.headExtra}` : ''}
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:${opts.bodyFontFamily};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${opts.preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="${maxWidth}" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;max-width:${maxWidth}px;width:100%;">
          <tr>
            <td style="background-color:#0d9488;padding:24px 32px;text-align:center;">
              <span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">${escapeHtml(brandName)}</span>
            </td>
          </tr>
          <tr>
            <td${opts.bodyCellAttrs}>
              ${opts.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #e4e4e7;text-align:center;color:#71717a;font-size:13px;">
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
    const rtl = isRTLText(params.body);
    const dir = rtl ? 'rtl' : 'ltr';
    const lang = rtl ? 'ar' : 'en';
    const align = rtl ? 'right' : 'left';
    const fontFamily = rtl
        ? "'Cairo','Tajawal',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        : "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
    const brandName = getBrandName();
    const unsubscribeLabel = rtl ? 'إلغاء الاشتراك' : 'Unsubscribe';

    return emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: params.subject,
        preheader: escapeHtml(params.body.slice(0, 150)),
        bodyCellAttrs: ` dir="auto" style="padding:32px;color:#18181b;font-size:16px;line-height:1.6;text-align:${align};font-family:${fontFamily};"`,
        bodyHtml: htmlBody,
        footerHtml: `<p style="margin:0 0 8px 0;">${escapeHtml(brandName)} &mdash; jawab24.com</p>
              <p style="margin:0;">
                <a href="${params.unsubscribeUrl}" style="color:#71717a;text-decoration:underline;font-size:12px;">${unsubscribeLabel}</a>
              </p>`,
    });
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
    const rtl = lang === 'ar';
    const dir = rtl ? 'rtl' : 'ltr';
    const align = rtl ? 'right' : 'left';
    const fontFamily = rtl
        ? "'Cairo','Tajawal',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        : "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

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
        ? `<p style="margin:0 0 16px 0;color:#0f766e;background-color:#f0fdfa;border-${rtl ? 'right' : 'left'}:3px solid #14b8a6;padding:12px 16px;border-radius:6px;">${t('subscriptionWelcomeTrialNote', lang).replace(/\{trialEnd\}/g, escapeHtml(formatDigestDate(trialEndsAt, lang)))}</p>`
        : '';

    const html = emailShell({
        lang,
        dir,
        bodyFontFamily: fontFamily,
        title: subject,
        preheader: intro,
        bodyCellAttrs: ` dir="auto" style="padding:32px;color:#18181b;font-size:16px;line-height:1.6;text-align:${align};font-family:${fontFamily};"`,
        bodyHtml: `<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#0f172a;">${heading}</h1>
              <p style="margin:0 0 16px 0;">${intro}</p>
              ${trialBlock}
              <p style="margin:0 0 24px 0;">${nextSteps}</p>
              <p style="margin:0 0 24px 0;text-align:center;">
                <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background-color:#0d9488;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:15px;">${ctaLabel}</a>
              </p>
              <p style="margin:24px 0 0 0;color:#52525b;font-size:14px;">${billing}</p>
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
    const escUrl = escapeHtml(inviteUrl);
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
                <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;color:#0f172a;">${t('inviteEmailHeading', lang)}</h1>
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
              <p style="margin:28px 0 0 0;text-align:center;">
                <a href="${escUrl}" style="display:inline-block;background-color:#0d9488;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">${ctaLabel}</a>
              </p>
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

function formatDigestDate(d: Date, lang: 'ar' | 'en'): string {
    try {
        return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(d);
    } catch {
        return d.toISOString().slice(0, 16).replace('T', ' ');
    }
}

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

    const countStr = String(params.leadCount);
    const subject = t('leadDigestSubject', lang, { count: countStr });
    const heading = t('leadDigestHeading', lang);
    const intro = t('leadDigestIntro', lang, { count: countStr });
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
        const date = escapeHtml(formatDigestDate(lead.createdAt, lang));
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
            bodyHtml: `<h1 style="margin:0 0 8px 0;font-size:22px;color:#0d9488;">${escapeHtml(heading)}</h1>
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
              <p style="margin:28px 0 0 0;text-align:center;">
                <a href="${params.dashboardUrl}" style="display:inline-block;background-color:#0d9488;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">${escapeHtml(cta)}</a>
              </p>`,
        }),
    };
}
