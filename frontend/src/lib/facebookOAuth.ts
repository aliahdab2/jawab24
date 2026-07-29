/**
 * Single source of truth for the Facebook OAuth dialog URL.
 *
 * Consolidates three literals that had drifted apart in maintenance risk if not
 * yet in content: `login.tsx` (mobile + web) and `pages.tsx` (page reconnect).
 * Each rebuilt the same URL and repeated the same ten-permission scope string, so
 * adding or removing a Meta permission meant editing three places — and if one was
 * missed, reconnect would silently request fewer scopes than login and the merchant
 * would lose a capability with no error anywhere to explain it.
 *
 * This module is a PURE REFACTOR: `buildFacebookOAuthUrl` emits a byte-identical
 * URL to the literals it replaced, including parameter order. `facebookOAuth.test.ts`
 * pins each of the three shapes against the exact former string, so a change here
 * that alters the wire format fails loudly rather than breaking login in production.
 */

/**
 * Graph version for the OAuth DIALOG only — deliberately still v18.0, matching
 * what the three call sites emitted before this refactor.
 *
 * It does NOT match the rest of the system: `backend/src/config/index.ts` defaults
 * to v23.0 (env-overridable via FACEBOOK_GRAPH_API_VERSION) and
 * `lib/whatsappSignup.ts` pins v23.0 for the JS SDK. That divergence is real and
 * predates this change; unifying it moves behaviour and belongs in its own commit,
 * so it is deliberately NOT bundled here — a refactor and a third-party API version
 * bump landing together would leave a login regression un-attributable to either.
 */
export const FB_OAUTH_GRAPH_VERSION = 'v18.0';

/**
 * The permissions every Facebook OAuth entry point requests. One list, because
 * login and reconnect asking for different scopes is a silent capability loss.
 *
 * Order is preserved from the original literal — it has no semantic meaning to
 * Meta, but keeping it lets the byte-identical assertions in the tests hold.
 */
export const FB_SCOPES = [
    'email',
    'pages_show_list',
    'pages_read_engagement',
    'pages_read_user_content',
    'pages_manage_metadata',
    'pages_manage_engagement',
    'pages_messaging',
    'instagram_basic',
    'instagram_manage_messages',
    'instagram_manage_comments',
] as const;

export interface FacebookOAuthUrlParams {
    /** Meta app id. Interpolated raw, as the original literals did. */
    appId: string;
    /** Unencoded redirect target; encoded here so callers cannot forget to. */
    redirectUri: string;
    /** Unencoded state payload (`returnUrl|platform|locale[|reconnect]`). */
    state: string;
    /**
     * Meta's dialog chrome. `touch` for mobile web (narrow viewport), `page`
     * otherwise. Native flows use `page` because the dialog renders in a system
     * browser tab, not inline.
     */
    display: 'page' | 'touch';
    /**
     * Adds `auth_type=rerequest`, which makes Meta re-prompt for permissions the
     * user previously declined instead of silently returning the old grant. Needed
     * by page reconnect, where the whole point is recovering a missing scope.
     */
    rerequest?: boolean;
}

/**
 * Builds the Facebook OAuth dialog URL.
 *
 * Parameter order is fixed and matches the literals this replaced. Do not reorder
 * or switch to URLSearchParams: the tests assert exact strings, and `+`-vs-`%20`
 * space encoding differs between URLSearchParams and encodeURIComponent.
 */
export function buildFacebookOAuthUrl({
    appId,
    redirectUri,
    state,
    display,
    rerequest = false,
}: FacebookOAuthUrlParams): string {
    const scope = encodeURIComponent(FB_SCOPES.join(','));
    const url =
        `https://www.facebook.com/${FB_OAUTH_GRAPH_VERSION}/dialog/oauth`
        + `?client_id=${appId}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&scope=${scope}`
        + `&response_type=code`
        + `&state=${encodeURIComponent(state)}`
        + `&display=${display}`;
    return rerequest ? `${url}&auth_type=rerequest` : url;
}
