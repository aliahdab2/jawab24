/**
 * Build-time feature flags. `NEXT_PUBLIC_*` values are inlined by Next.js at
 * build time, so these are plain constants — safe to import anywhere.
 */

/**
 * Gates ALL phone / SMS UI: the login phone tab, phone-based team invites, the
 * sidebar phone name-fallback, and the (dormant) phone-collect page.
 *
 * OFF until WhatsApp Cloud API OTP replaces SMS. SMS verification cannot be
 * delivered to our core markets (Syria is sanctions-blocked; Saudi Arabia
 * denies foreign A2P SMS; Libya is unreliable), so phone features are hidden
 * everywhere for now. Onboarding never forces a phone regardless of this flag —
 * that is decoupled at the code level (see backend/src/controllers/auth.ts).
 *
 * When WhatsApp OTP ships, flip NEXT_PUBLIC_PHONE_AUTH_ENABLED=true to re-enable
 * phone features for deliverable regions; Syria stays exempt (see
 * @jawab24/shared SMS_BLOCKED_DIAL_PREFIXES).
 */
export const PHONE_AUTH_ENABLED = process.env.NEXT_PUBLIC_PHONE_AUTH_ENABLED === 'true';
