/**
 * Can a page's own Facebook posts be scanned into catalog proposals?
 *
 * ONE definition, used by both sides of the feature:
 *  - the backend (`services/catalogScan.ts`) throws `CatalogScanUnavailableError`
 *    → 409 `PAGE_DISCONNECTED` when a page is ineligible;
 *  - the frontend (`utils/page.ts` → `CatalogManager`) hides the scan action and
 *    explains why, so the merchant never reaches that 409.
 *
 * It lives here because the two sides disagreeing IS the bug class: prod
 * 2026-07-27 offered «find products in your posts» on WhatsApp-only and
 * token-less pages, and the resulting 409 surfaced as "Couldn't read your posts.
 * Please try again." — advice that could never work. A rule copied into two
 * packages drifts the moment a third precondition appears; a rule imported twice
 * cannot.
 *
 * Each caller supplies `hasUsableToken` from the fact IT holds — the backend
 * decrypts the stored token, the client reads the derived `isConnected` flag —
 * because the credential itself is never sent to the browser.
 */

/** Why the posts scan cannot run — also selects the merchant-facing copy. */
export type PostsScanBlocker =
    /** No Facebook identity at all (a WhatsApp-only page has no posts to read). */
    | 'noFacebook'
    /** Facebook page, but no usable token to read its posts with. */
    | 'disconnected';

export interface PostsScanEligibilityInput {
    /** The page's Facebook page id, or null/undefined when it has none. */
    facebookPageId: string | null | undefined;
    /** Whether a usable (decrypted, non-empty) page token is available. */
    hasUsableToken: boolean;
}

/**
 * Eligible results carry the non-null `facebookPageId`, so a caller that checked
 * eligibility can pass it to the Graph API without re-testing it — the guard and
 * the type narrowing are the same step.
 */
export type PostsScanEligibility =
    | { eligible: true; facebookPageId: string }
    | { eligible: false; blocker: PostsScanBlocker };

/**
 * Whether the posts scan can run for this page, and if not, why.
 *
 * Order matters: a page with no Facebook identity reports `noFacebook` even when
 * it also has no token — "reconnect Facebook" is not the fix for a WhatsApp-only
 * page, and telling merchants to reconnect something they never connected is
 * worse than saying nothing.
 */
export function postsScanEligibility(page: PostsScanEligibilityInput): PostsScanEligibility {
    if (!page.facebookPageId) return { eligible: false, blocker: 'noFacebook' };
    if (!page.hasUsableToken) return { eligible: false, blocker: 'disconnected' };
    return { eligible: true, facebookPageId: page.facebookPageId };
}
