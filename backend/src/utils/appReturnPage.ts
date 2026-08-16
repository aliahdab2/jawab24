import { config } from '../config';
import { escapeHtml } from './htmlUtils';
import { t } from './i18n';

/**
 * The browser→app RETURN page shared by every app↔browser connect flow
 * (WhatsApp redirect connect, Instagram-direct connect).
 *
 * A server 302 to an App Link is NOT intercepted by Android — the browser
 * follows it inside its own request chain and renders the web fallback
 * (Rule 17b, learned across seven Android releases). `auth/callback.tsx`
 * gets this right — it finishes its work and then does
 * `window.location.href = <app-sync>` — so this mirrors it: a document whose
 * SCRIPT performs the navigation.
 *
 * The anchor is not decoration: if the script is blocked or the App Link
 * verification has lapsed, the merchant still has a way back instead of a
 * blank tab.
 *
 * The waReturn* strings are generic («Returning to Jawab24») and deliberately
 * shared across flows. One copy of this document — the WhatsApp and Instagram
 * controllers briefly carried byte-identical twins (PR #772 re-review,
 * Rule 10.8).
 */
export function appReturnPage(appSyncUrl: string, locale: 'ar' | 'en'): string {
    const href = escapeHtml(appSyncUrl);
    return `<!DOCTYPE html>
<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="${config.frontendUrl}/brand/favicon-32x32.png">
<title>${escapeHtml(t('waReturnTitle', locale))}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         padding:24px; box-sizing:border-box; background:#f8fafc; color:#0f172a;
         font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; text-align:center; }
  img { width:64px; height:64px; margin:0 auto 16px; display:block; }
  p { font-size:15px; color:#475569; margin:0 0 16px; }
  a { color:#0f9d76; font-weight:600; }
  @media (prefers-color-scheme: dark) {
    body { background:#0f172a; color:#f1f5f9; } p { color:#94a3b8; }
  }
</style>
</head>
<body>
  <main>
    <img src="${config.frontendUrl}/brand/icon-vector.svg" width="64" height="64" alt="Jawab24">
    <p>${escapeHtml(t('waReturnBody', locale))}</p>
    <a href="${href}">${escapeHtml(t('waReturnCta', locale))}</a>
  </main>
  <script>location.replace(${JSON.stringify(appSyncUrl)});</script>
</body>
</html>`;
}
