import { config } from '../config';
import { hasActiveStoreForBillingSubject } from './ecommerce';

/**
 * Why WhatsApp connect is unavailable for a workspace, INDEPENDENT of the plan
 * and allowlist gates. This is a channel-availability question, not an
 * entitlement one: a fully-paid Business merchant is still blocked here if their
 * account is a Zid store.
 *
 * The only reason today is a store connected through Zid. Zid's App Market
 * paused WhatsApp-integrated apps (2026-08-30 category hold) and confirmed that
 * app 7367 can be reviewed and approved for Facebook + Instagram ONLY while the
 * WhatsApp channel is switched off. The reviewer opens the full Jawab24
 * dashboard inside the Zid iframe, so hiding the buttons is not enough — the
 * connect must be refused server-side and keyed on the workspace, never on
 * `isFramed()`. Ruling D-117.
 */
export type WhatsAppUnavailableReason = 'zid_marketplace';

/**
 * Resolve the availability reason for a workspace's BILLING SUBJECT (the
 * workspace owner) — the same subject rule `hasWhatsAppPlanAccess` uses, so the
 * two gates agree on whose stores/plan decide.
 *
 * ⛔ Deliberately NOT `resolveMarketplaceBilling`: that resolver has a Stripe
 * exemption (a Zid-store owner who happens to pay through Stripe resolves to
 * `null`), which would let exactly that merchant connect WhatsApp — the opposite
 * of what Zid requires. `hasActiveStoreForBillingSubject('zid', …)` answers the
 * real question ("does this account have a live Zid store?") without the billing
 * short-circuit.
 *
 * `config.whatsappZidBlock` (env `WHATSAPP_ZID_BLOCK`, default ON) is the
 * rollback switch for when Zid reopens the WhatsApp category.
 */
export async function getWhatsAppUnavailableReason(
    workspaceOwnerId: string,
): Promise<WhatsAppUnavailableReason | null> {
    if (!config.whatsappZidBlock) return null;
    if (await hasActiveStoreForBillingSubject('zid', workspaceOwnerId)) {
        return 'zid_marketplace';
    }
    return null;
}

/**
 * The 403 body every WhatsApp connect surface sends when the account is blocked
 * by `getWhatsAppUnavailableReason`. A sibling of `PLAN_REQUIRED_RESPONSE`;
 * lives here so the two controllers (`whatsapp.ts`, `whatsappRedirect.ts`) share
 * one definition and the frontend's `keyByCode` has one code to map.
 */
export const WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE = {
    error: 'WhatsApp isn\'t available for stores connected through Zid.',
    code: 'WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE',
    marketplace: 'zid',
} as const;
