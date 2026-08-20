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

/**
 * Redirect-based WhatsApp connect (full-page Embedded Signup, no popup).
 *
 * ON: every platform starts the connect via POST /auth/whatsapp/start and a
 * full-page navigation to Meta's dialog — works in phone browsers and the
 * app's Custom Tab, where the fb.login popup never painted (2026-07-30).
 * OFF: the legacy popup flow. Paired with the backend WHATSAPP_CONNECT_REDIRECT
 * flag (which 404s the new routes); flip BOTH for rollout or rollback.
 */
export function isWhatsAppRedirectConnect(): boolean {
  return process.env.NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT === 'true';
}

/**
 * Instagram-DIRECT connect (Instagram Login, no Facebook Page). Dark by
 * default: the option appears only once the flag is on AND the backend's
 * INSTAGRAM_APP_* credentials are configured (the /start endpoint 404s
 * otherwise — defence in depth, same layering as the WhatsApp flags).
 */
export function isInstagramDirectEnabled(): boolean {
  return process.env.NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED === 'true';
}

/**
 * Canary window: while NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY is 'true', the
 * WhatsApp surface is shown ONLY to platform admins (the founder), even though
 * the config is live. This lets us set the config in prod (so connect actually
 * works) and pilot with the founder first, without exposing the surface — or
 * the Meta signup popup — to every customer. Pair with the backend
 * WHATSAPP_ALLOWLIST (which hard-gates who may connect). To full-launch: unset
 * this flag (everyone sees it) and clear the backend allowlist (everyone connects).
 *
 * @param isAdmin the ACTING user's platform-admin flag (useAuthStore user.isAdmin)
 */
export function isWhatsAppVisible(isAdmin: boolean): boolean {
  if (!isWhatsAppEnabled()) return false;
  if (process.env.NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY === 'true') return isAdmin;
  return true;
}

/**
 * Gates the PUBLIC marketing surfaces (pricing plan cards, scale page,
 * checkout summary). Stricter than `isWhatsAppEnabled()`: the launch runbook
 * sets the config env DURING the admin-only canary, and the pricing page must
 * not advertise WhatsApp to everyone while the in-app surface is founder-only.
 * Full launch unsets the canary flag + rebuilds, so the marketing rows appear
 * exactly at public launch with no extra step.
 */
export function isWhatsAppMarketable(): boolean {
  return isWhatsAppEnabled() && process.env.NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY !== 'true';
}

/**
 * «بوست اليوم» pilot (owner rulings 2026-08-09: «just for aliahdab@gmail.com
 * workspace»; ONE post/day; 3 generations/day absolute). WORKSPACE-gated with
 * the founder workspace as the built-in default — the BUSINESS_SURFACE
 * pattern — so the pilot ships in the normal production build with no build
 * args and is visible only inside that workspace. The backend env gate
 * (POST_SUGGESTIONS_ENABLED, default OFF) stays the real enforcement — this
 * only hides the UI, and the card additionally fails closed on an API 404.
 * Override the list for local dev via NEXT_PUBLIC_POST_SUGGESTIONS_WORKSPACE_IDS.
 */
const POST_SUGGESTIONS_WORKSPACE_IDS: ReadonlySet<string> = new Set(
  (process.env.NEXT_PUBLIC_POST_SUGGESTIONS_WORKSPACE_IDS
    || [
      'a0005407-92bf-473e-9368-013f14c57a7d', // Jawab24 founder workspace (prod)
      // First merchant tester (2026-08-10, owner-invited) — a real business
      // helping exercise the pilot. Must stay in step with the backend's
      // POST_SUGGESTIONS_WORKSPACE_IDS default: this hides the card, the
      // backend decides, and a workspace listed in only one of the two either
      // sees a card whose API 404s or gets nothing while paying the cron cost.
      '9b6ba279-b569-4b45-b020-55b542dad5b6',
      // Second merchant tester (2026-08-11, owner-invited) — Waleed,
      // waleedraffas@gmail.com. Same both-gates rule as above.
      '30c90e2c-6ede-4e20-9b9e-9c5cd308e25d',
    ].join(','))
    .split(',').map((id) => id.trim()).filter(Boolean),
);

/** Whether the post-suggestions card may render for this workspace. */
export function isPostSuggestionsVisible(workspaceId: string | null | undefined): boolean {
  return Boolean(workspaceId && POST_SUGGESTIONS_WORKSPACE_IDS.has(workspaceId));
}

