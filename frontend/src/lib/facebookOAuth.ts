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
 * Graph version for the OAuth dialog, aligned with the rest of the system:
 * `backend/src/config/index.ts` defaults to v23.0 (env-overridable via
 * FACEBOOK_GRAPH_API_VERSION) and `lib/whatsappSignup.ts` pins v23.0 for the JS SDK.
 * The backend exchanges the code this dialog returns, so having both on the same
 * version is the point.
 *
 * Raised from v18.0 on 2026-07-29. v18.0 was not merely old — per Meta's version
 * changelog it EXPIRED on 2026-01-26, six months earlier. Meta silently auto-upgrades
 * calls on an expired version to the oldest available one, so login and page
 * reconnect were already running on a version nobody here chose or tested; pinning
 * v18.0 bought no stability, it only hid which version was actually serving us.
 *
 * Not v25.0 (newest, released 2026-02-18): matching the backend matters more than
 * being current, and one version for the whole system is easier to reason about than
 * two. When this is next raised, raise the backend default with it.
 */
export const FB_OAUTH_GRAPH_VERSION = 'v23.0';

/**
 * The permissions every Facebook OAuth entry point requests. One list, because
 * login and reconnect asking for different scopes is a silent capability loss.
 *
 * Order is preserved from the original literal — it has no semantic meaning to
 * Meta, but keeping it lets the exact-string assertions in the tests hold.
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
