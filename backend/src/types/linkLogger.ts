/**
 * The logger contract shared by the billing-rail reconcilers — the Stripe
 * linking service, the Shopify billing sync and the Zid billing sync all take
 * one of these so a webhook handler can pass `request.log` and a cron can pass
 * the server log (or nothing).
 *
 * WHY ITS OWN MODULE. It used to live in `services/subscriptionLinking.ts`, and
 * `shopifyBilling` / `zidBilling` imported it from there — meaning two rails
 * loaded the whole Stripe linking service just to name a logger type. That is
 * only a smell until the linking service grows a dependency, and then it is a
 * failure: adding `handlePaymentRecovery` (services/dunningNotices) to the
 * Stripe healer dragged the email + notification + redis chain into
 * `zidBilling.test.ts`, whose suite stopped loading entirely with
 * `Cannot read properties of undefined (reading 'host')` from lib/redis.
 *
 * A type shared by three modules belongs to none of them (Rule 10.9). Keeping
 * it here means a rail imports only what it actually uses, and no future
 * dependency of one rail can break another rail's tests.
 */

/** The subset of pino we need — satisfied by `request.log` and the server log. */
export interface LinkLogger {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
}

/**
 * Silent default for cron callers that pass no logger. NOT the `noopLogger`
 * in types/logger.ts — that interface has the opposite (msg, data) order.
 */
export const noopLinkLogger: LinkLogger = { info: () => {}, warn: () => {} };
