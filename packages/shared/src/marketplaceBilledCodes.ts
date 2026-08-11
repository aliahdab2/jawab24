/**
 * The wire codes a Stripe entry point returns when a MARKETPLACE owns the
 * account's paid plans (D-073), and the predicate every client uses to
 * recognize one.
 *
 * Why this lives in shared rather than beside each rail's config: the codes are
 * a CONTRACT between the backend's guard and every client that has to react to
 * a refusal. They were previously declared once per rail in
 * `backend/src/config/{shopify,salla,zid}Billing.ts` and then re-typed as bare
 * string literals on the client — which is precisely how `checkout.tsx` came to
 * handle `SHOPIFY_BILLED` and `SALLA_BILLED` but not `ZID_BILLED`, dropping a
 * Zid merchant onto the generic failure banner (the dead end D-073 exists to
 * prevent) on the one surface #720's field-based guard cannot cover.
 *
 * A field-based check (`subscription.marketplaceBilling`) stops a merchant
 * BEFORE they act; this code-based check catches the case where they arrive at a
 * Stripe surface anyway — a stale deep link, a bookmarked `/checkout?planId=…`,
 * or a summary that was fetched before the marketplace mirror existed. Both are
 * needed, and only this one can be exhaustive by construction.
 *
 * Adding a rail: extend the array. `MarketplaceBilledCode` and every consumer
 * widen with it, so a new rail cannot be silently unhandled.
 */

export const MARKETPLACE_BILLED_CODES = [
    'SHOPIFY_BILLED',
    'SALLA_BILLED',
    'ZID_BILLED',
] as const;

export type MarketplaceBilledCode = (typeof MARKETPLACE_BILLED_CODES)[number];

/**
 * True when an API error code means "a marketplace bills this account, so no
 * Stripe surface may proceed".
 *
 * Takes `unknown` on purpose: callers read it off a parsed error body, where the
 * field is untrusted and may be absent or a non-string.
 */
export function isMarketplaceBilledCode(code: unknown): code is MarketplaceBilledCode {
    return typeof code === 'string'
        && (MARKETPLACE_BILLED_CODES as readonly string[]).includes(code);
}
