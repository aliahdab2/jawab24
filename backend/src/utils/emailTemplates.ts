import { config } from '../config';

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
