import { iosOr } from './iosCopy';

/**
 * The merchant-facing message for a WhatsApp connect refusal, as an i18n key in
 * the `pages` namespace — or null when the failure is not a known gate refusal
 * and the caller should report it (Sentry) and show the generic message.
 *
 * ONE map, because a connect can be refused on four surfaces that each used to
 * carry their own copy: the popup flow's catch, the redirect flow's `start`
 * catch, the native `Browser.open` leg, and the `?whatsappError=` return handler
 * the callback 302s into. They drifted — the native leg reported an ordinary
 * billing refusal to Sentry and showed "connect failed", because it was the one
 * site nobody remembered to extend (Rule 10.8).
 *
 * A key returned from here means "expected refusal": show it, do NOT capture it.
 * Payment-steering copy goes through `iosOr` for App Store Guideline 3.1.1.
 */
export function whatsappConnectErrorKey(code: string | undefined | null): string | null {
  if (!code) return null;
  switch (code) {
    case 'WHATSAPP_NUMBER_TAKEN':
      return 'whatsappNumberTaken';
    case 'WHATSAPP_PIN_MISMATCH':
      return 'whatsappPinMismatch';
    case 'WHATSAPP_NO_NUMBER':
      return 'whatsappNoNumberSelected';
    case 'WHATSAPP_AMBIGUOUS':
      return 'whatsappAmbiguousNumber';
    case 'WHATSAPP_PLAN_REQUIRED':
      return iosOr('whatsappPlanRequiredIOS', 'whatsappPlanRequired');
    case 'WHATSAPP_SUBSCRIPTION_INACTIVE':
      return iosOr('subscriptionInactiveIOS', 'subscriptionInactive');
    case 'WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE':
      return 'whatsappUnavailableForMarketplace';
    case 'WHATSAPP_NOT_ALLOWLISTED':
      // A canary-window refusal: expected, so never captured. It has no copy of
      // its own — the surface is hidden behind the canary flag, so only a stale
      // tab can reach it — and it keeps the generic message it always had.
      return 'whatsappConnectFailed';
    default:
      return null;
  }
}
