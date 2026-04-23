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

/**
 * Generates a branded HTML email for waitlist campaigns.
 * Auto-detects RTL for Arabic content.
 * Includes per-recipient unsubscribe link (CAN-SPAM compliance).
 */
export function waitlistEmailTemplate(params: {
    subject: string;
    body: string;
    unsubscribeUrl: string;
}): string {
    const htmlBody = escapeHtml(params.body).replace(/\n/g, '<br>');
    const rtl = isRTLText(params.body);
    const dir = rtl ? 'rtl' : 'ltr';
    const lang = rtl ? 'ar' : 'en';
    const align = rtl ? 'right' : 'left';
    const fontFamily = rtl
        ? "'Cairo','Tajawal',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
        : "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
    const brandName = config.resend.fromName || 'Jawab24';
    const unsubscribeLabel = rtl ? 'إلغاء الاشتراك' : 'Unsubscribe';

    return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(params.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:${fontFamily};">
  <!-- Preheader (hidden preview text for inbox) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${escapeHtml(params.body.slice(0, 150))}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background-color:#0d9488;padding:24px 32px;text-align:center;">
              <span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">${escapeHtml(brandName)}</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td dir="auto" style="padding:32px;color:#18181b;font-size:16px;line-height:1.6;text-align:${align};font-family:${fontFamily};">
              ${htmlBody}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #e4e4e7;text-align:center;color:#71717a;font-size:13px;">
              <p style="margin:0 0 8px 0;">${escapeHtml(brandName)} &mdash; jawab24.com</p>
              <p style="margin:0;">
                <a href="${params.unsubscribeUrl}" style="color:#71717a;text-decoration:underline;font-size:12px;">${unsubscribeLabel}</a>
              </p>
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
 * Lead digest email — sent once per day to the workspace owner when they
 * have 10+ new (non-emailed) leads. Lists up to MAX_ROWS leads in a table
 * with an "and N more" line if truncated.
 */
export interface LeadDigestRow {
    name: string | null;
    phone: string;
    sourceType: 'message' | 'comment' | string;
    createdAt: Date;
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
    const brandName = config.resend.fromName || 'Jawab24';

    const countStr = String(params.leadCount);
    const subject = t('leadDigestSubject', lang, { count: countStr });
    const heading = t('leadDigestHeading', lang);
    const intro = t('leadDigestIntro', lang, { count: countStr });
    const cta = t('leadDigestCta', lang);
    const thName = t('leadDigestTableName', lang);
    const thPhone = t('leadDigestTablePhone', lang);
    const thSource = t('leadDigestTableSource', lang);
    const thDate = t('leadDigestTableDate', lang);
    const srcMsg = t('leadDigestSourceMessage', lang);
    const srcCmt = t('leadDigestSourceComment', lang);

    const rows = params.leads.slice(0, DIGEST_MAX_ROWS);
    const remaining = Math.max(0, params.leadCount - rows.length);

    const tableRows = rows.map(lead => {
        const name = escapeHtml(lead.name?.trim() || '—');
        const phone = escapeHtml(lead.phone);
        const source = escapeHtml(lead.sourceType === 'comment' ? srcCmt : srcMsg);
        const date = escapeHtml(formatDigestDate(lead.createdAt, lang));
        return `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;">${name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;" dir="ltr">${phone}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#52525b;">${source}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#52525b;">${date}</td>
        </tr>`;
    }).join('');

    const andMore = remaining > 0
        ? `<p style="margin:16px 0 0 0;color:#71717a;font-size:14px;">${escapeHtml(t('leadDigestAndMore', lang, { count: String(remaining) }))}</p>`
        : '';

    return {
        subject,
        html: `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:${fontFamily};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(intro)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
          <tr>
            <td style="background-color:#0d9488;padding:24px 32px;text-align:center;">
              <span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">${escapeHtml(brandName)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#18181b;font-size:16px;line-height:1.6;text-align:${align};font-family:${fontFamily};">
              <h1 style="margin:0 0 8px 0;font-size:22px;color:#0d9488;">${escapeHtml(heading)}</h1>
              <p style="margin:0 0 20px 0;color:#3f3f46;">${escapeHtml(intro)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">
                <thead>
                  <tr style="background-color:#fafafa;">
                    <th align="${align}" style="padding:10px 12px;border-bottom:2px solid #e4e4e7;font-size:13px;color:#71717a;font-weight:600;">${escapeHtml(thName)}</th>
                    <th align="${align}" style="padding:10px 12px;border-bottom:2px solid #e4e4e7;font-size:13px;color:#71717a;font-weight:600;">${escapeHtml(thPhone)}</th>
                    <th align="${align}" style="padding:10px 12px;border-bottom:2px solid #e4e4e7;font-size:13px;color:#71717a;font-weight:600;">${escapeHtml(thSource)}</th>
                    <th align="${align}" style="padding:10px 12px;border-bottom:2px solid #e4e4e7;font-size:13px;color:#71717a;font-weight:600;">${escapeHtml(thDate)}</th>
                  </tr>
                </thead>
                <tbody>${tableRows}</tbody>
              </table>
              ${andMore}
              <p style="margin:28px 0 0 0;text-align:center;">
                <a href="${params.dashboardUrl}" style="display:inline-block;background-color:#0d9488;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">${escapeHtml(cta)}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #e4e4e7;text-align:center;color:#71717a;font-size:13px;">
              <p style="margin:0;">${escapeHtml(brandName)} &mdash; jawab24.com</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    };
}
