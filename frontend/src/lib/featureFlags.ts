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

/**
 * Master switch for the ENTIRE WhatsApp surface: the connect picker, the
 * per-card WhatsApp row, dashboard channel badges, the "Channels" rename, and
 * the launch nudge. True only once Meta has approved our Embedded Signup and
 * NEXT_PUBLIC_WHATSAPP_CONFIG_ID is deployed alongside the app id.
 *
 * With the flag OFF the app is byte-for-byte identical to the pre-WhatsApp
 * experience, so the code can ship "dark" with zero change for existing
 * Facebook/Instagram customers; unsetting the var is an instant kill switch
 * (no rollback deploy). Components OR this with `page.whatsappConnected` so an
 * already-connected number is never hidden if the flag is later turned off.
 */
export function isWhatsAppEnabled(): boolean {
  return !!process.env.NEXT_PUBLIC_FB_APP_ID && !!process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID;
}
