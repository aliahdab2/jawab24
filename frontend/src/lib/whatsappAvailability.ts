import type { UsageSummary } from '@jawab24/shared';

/**
 * Whether the WhatsApp CONNECT flow may be offered on this account.
 *
 * Two layers: `whatsappVisible` is the env/canary flag
 * (`featureFlags.isWhatsAppVisible`); on top of it, an account with a store
 * connected through Zid can never connect WhatsApp — Zid's App Market paused
 * WhatsApp-integrated apps and app 7367 ships for Facebook + Instagram only with
 * WhatsApp off (D-117). The backend refuses the connect for such accounts and
 * reports it in the usage summary as `subscription.whatsappUnavailable`; this
 * reads that so the UI can never offer a connect the API will 403.
 *
 * Returns `undefined` while the usage summary is still loading — the same
 * three-state convention as `whatsappEntitled` on /pages. Every ACTIONABLE
 * surface must therefore require `=== true` (not merely `!== false`), so nothing
 * offers WhatsApp to a Zid merchant in the window between mount and the first
 * usage response. Passive surfaces (an already-connected number's row) may use
 * `!== false` to avoid a flash for the common non-Zid case.
 */
export function isWhatsAppConnectable(
    whatsappVisible: boolean,
    usage: UsageSummary | null | undefined,
): boolean | undefined {
    if (!whatsappVisible) return false;
    if (usage === undefined) return undefined; // still loading — decide nothing yet
    return !usage?.subscription?.whatsappUnavailable;
}
