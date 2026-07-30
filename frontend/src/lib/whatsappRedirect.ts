import { api } from './api';

/**
 * Start the redirect-based WhatsApp connect: ask the backend to mint the
 * signed OAuth state + nonce cookie and hand back Meta's dialog URL, then
 * navigate the WHOLE page there. No popup anywhere — this is what lets the
 * flow work in phone browsers and the app's Custom Tab, where `fb.login`'s
 * popup never painted (2026-07-30).
 *
 * The backend re-checks every gate (allowlist, plan, ownership) and, on a
 * reconnect, overrides `coexistence` with the number's STORED path — so
 * callers here can pass the merchant's answer without owning that invariant.
 *
 * Meta 302s back to /pages?whatsappConnected=1&waPageId=… or
 * /pages?whatsappError=<code>; pages.tsx consumes those.
 */
export async function startWhatsAppConnect(options: {
  pageId: string | null;
  coexistence: boolean;
  locale: string;
}): Promise<void> {
  const { data } = await api.post<{ url: string }>('/auth/whatsapp/start', {
    pageId: options.pageId,
    coexistence: options.coexistence,
    locale: options.locale,
  });
  window.location.assign(data.url);
}
