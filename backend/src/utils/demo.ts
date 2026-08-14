/**
 * Demo-account detection.
 *
 * Demo users are seeded with `facebook_id` values under the `demo_` prefix
 * (`config.demo.userFacebookId` = 'demo_user_jawab24'); real Facebook ids are
 * numeric, so the prefix can never collide. The frontend mirrors this exact
 * convention in `useIsDemoUser()` (frontend/src/features/demo/useDemoMode.ts)
 * — keep the two in sync.
 *
 * Why it matters (prod incident 2026-07-18): identity-linking endpoints
 * (/auth/facebook/link, /auth/phone/link) mutate the CURRENT user row. Run
 * from a demo session they overwrite the SHARED demo account — a merchant
 * linked their real Facebook this way, hijacking the demo user and breaking
 * demo login for everyone.
 *
 * ⚠️ The rule is NOT limited to identity-linking, and saying so here once cost
 * us a month: DELETE /auth/me went unguarded until 2026-08-14 because the only
 * stated rule covered "linking", and deleting is not linking. A demo session
 * could destroy the shared row outright — worse than overwriting it.
 *
 * The actual rule: **any endpoint that mutates or destroys the CURRENT user row
 * must refuse demo sessions via this check** — linking, deletion, profile
 * edits, anything keyed on `request.user.userId`. "My account" is not a private
 * row in a demo session; it is everyone's.
 *
 * Guarded today: /auth/facebook/link, /auth/phone/link, DELETE /auth/me.
 * NOT guarded: PATCH /auth/profile (updateProfile) writes name/email to the
 * current row. No UI path reaches it from a demo session today — its only
 * caller, complete-profile.tsx, is entered when an email is MISSING and the
 * demo user is seeded with `config.demo.userEmail` — so this is hardening, not
 * a live hole. Guard it if that ever changes, or when convenient.
 */
export function isDemoFacebookId(facebookId: string | null | undefined): boolean {
    return isDemoPlatformId(facebookId);
}

/**
 * Every seeded demo entity shares the `demo_` platform-id prefix — users
 * (`demo_user_jawab24`), pages (`demo_page_*`), posts (`demo_post_*`); see
 * plugins/demo/seedData.ts. Real Meta ids are numeric, so no collision.
 * Use this anywhere a code path must not hit the real Graph API for demo data.
 */
export function isDemoPlatformId(platformId: string | null | undefined): boolean {
    return platformId?.startsWith('demo_') ?? false;
}
