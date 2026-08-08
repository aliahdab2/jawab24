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
 * TEMP (catalog canary): the native-catalog surface (/catalog page, its nav
 * entry, the KB price-list-warning import CTA) is visible only to PLATFORM
 * admins — same gate as the Stores page — so the founder can dogfood the
 * catalog + bulk import from any admin account while every customer sees a
 * byte-identical app. Widened from the founder-email allowlist on 2026-07-11
 * (owner call: "keep it dark, but admin so I can test"). The backend CRUD
 * stays auth + workspace-admin gated regardless; this flag only hides the UI.
 * Remaining rollout path: delete the gate at GA (catalog plan, Phase D).
 */
/** Workspaces the business surface is open to ahead of GA (owner ruling
 *  2026-08-03: «لفريق وركسبيسي بس») — the founder's own team dogfoods the
 *  page in production before all merchants get it. */
const BUSINESS_SURFACE_WORKSPACE_IDS: ReadonlySet<string> = new Set([
  'a0005407-92bf-473e-9368-013f14c57a7d', // Jawab24 founder workspace (prod)
  // Feras (feras10mgb) — first external merchant (owner ruling 2026-08-04):
  // both his pages were seeded with fact collections that day, and the lists
  // editor on /business is the only surface where he can review/refine them
  // (incl. the literal-translation الوصف rows). Server-side stays
  // workspace-admin gated; he is the workspace owner.
  'c54202c9-139e-4b6f-9984-c19d0e8757a4',
  // Ahmad (a.tbbaa@mes-me.com, «ام. اي. اس») — second seeded external merchant
  // (owner ruling 2026-08-08): his showroom + department-phone fact collections
  // went live 08-07, and /business is the only surface where he can review/edit
  // them — a prerequisite for the KB prose cleanup, which removes their free-text
  // duplicates (.planning/MES_CLEANUP_REVIEW.md).
  '9b6ba279-b569-4b45-b020-55b542dad5b6',
]);

export function isCatalogVisible(
  user: { isAdmin?: boolean } | null | undefined,
  workspaceIds?: readonly string[],
): boolean {
  if (user?.isAdmin === true) return true;
  return (workspaceIds ?? []).some((id) => BUSINESS_SURFACE_WORKSPACE_IDS.has(id));
}
