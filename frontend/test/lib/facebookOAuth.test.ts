import { describe, it, expect } from 'vitest';
import { buildFacebookOAuthUrl, FB_SCOPES, FB_OAUTH_GRAPH_VERSION } from '@/lib/facebookOAuth';

/**
 * These assertions pin the exact wire format of the OAuth dialog URL.
 *
 * `buildFacebookOAuthUrl` consolidated three inline template literals — login.tsx
 * (mobile + web) and pages.tsx (page reconnect). The expected strings below started
 * life as those literals verbatim, which is what made the consolidation provable;
 * life as those literals verbatim; the only thing since changed on purpose is the
 * Graph version (v18.0 → v23.0, 2026-07-29). Parameter order, encoding and which
 * params appear must stay put. If any of it moves, these fail here rather than in production, where
 * the symptom is merchants unable to log in or reconnect a page and nothing to
 * reproduce locally.
 *
 * The scope string is spelled out literally rather than derived from FB_SCOPES on
 * purpose: deriving it would make the test pass no matter which permissions the
 * constant happens to hold, and losing a permission silently is precisely the
 * failure this consolidation is meant to prevent.
 */
const SCOPE = 'email%2Cpages_show_list%2Cpages_read_engagement%2Cpages_read_user_content'
    + '%2Cpages_manage_metadata%2Cpages_manage_engagement%2Cpages_messaging%2Cinstagram_basic'
    + '%2Cinstagram_manage_messages%2Cinstagram_manage_comments';

describe('buildFacebookOAuthUrl — pinned wire format', () => {
    it('login.tsx mobile: server callback, display=page', () => {
        expect(buildFacebookOAuthUrl({
            appId: '774211662298446',
            redirectUri: 'https://jawab24.com/api/auth/facebook/mobile-callback',
            state: '/dashboard|mobile|en',
            display: 'page',
        })).toBe(
            'https://www.facebook.com/v23.0/dialog/oauth'
            + '?client_id=774211662298446'
            + '&redirect_uri=https%3A%2F%2Fjawab24.com%2Fapi%2Fauth%2Ffacebook%2Fmobile-callback'
            + `&scope=${SCOPE}`
            + '&response_type=code'
            + '&state=%2Fdashboard%7Cmobile%7Cen'
            + '&display=page',
        );
    });

    it('login.tsx web: mobile-web viewport gets display=touch', () => {
        expect(buildFacebookOAuthUrl({
            appId: '774211662298446',
            redirectUri: 'https://jawab24.com/ar/auth/callback',
            state: '/dashboard|web|ar',
            display: 'touch',
        })).toBe(
            'https://www.facebook.com/v23.0/dialog/oauth'
            + '?client_id=774211662298446'
            + '&redirect_uri=https%3A%2F%2Fjawab24.com%2Far%2Fauth%2Fcallback'
            + `&scope=${SCOPE}`
            + '&response_type=code'
            + '&state=%2Fdashboard%7Cweb%7Car'
            + '&display=touch',
        );
    });

    it('pages.tsx reconnect: appends auth_type=rerequest, last', () => {
        expect(buildFacebookOAuthUrl({
            appId: '774211662298446',
            redirectUri: 'https://jawab24.com/en/auth/callback',
            state: '/pages|web|en|reconnect',
            display: 'page',
            rerequest: true,
        })).toBe(
            'https://www.facebook.com/v23.0/dialog/oauth'
            + '?client_id=774211662298446'
            + '&redirect_uri=https%3A%2F%2Fjawab24.com%2Fen%2Fauth%2Fcallback'
            + `&scope=${SCOPE}`
            + '&response_type=code'
            + '&state=%2Fpages%7Cweb%7Cen%7Creconnect'
            + '&display=page'
            + '&auth_type=rerequest',
        );
    });

    it('omits auth_type entirely unless rerequest is asked for', () => {
        const url = buildFacebookOAuthUrl({
            appId: 'app', redirectUri: 'https://x.test/cb', state: 's', display: 'page',
        });
        expect(url).not.toContain('auth_type');
    });

    it('still requests all ten permissions, in order', () => {
        // A dropped permission is a silent capability loss for every merchant who
        // authorises after the change — no error, just a feature that stops working.
        expect(FB_SCOPES).toHaveLength(10);
        expect(FB_SCOPES[0]).toBe('email');
        expect(FB_SCOPES[FB_SCOPES.length - 1]).toBe('instagram_manage_comments');
    });

    it('pins the dialog Graph version to the one the rest of the system uses', () => {
        // Must match backend config.graphApiVersion's default and whatsappSignup.ts —
        // the backend exchanges the code this dialog returns. v18.0 sat here until
        // 2026-07-29, six months AFTER Meta expired it (2026-01-26), during which
        // Meta was silently serving some unknown newer version. Raise the backend
        // default in the same change next time.
        expect(FB_OAUTH_GRAPH_VERSION).toBe('v23.0');
    });
});
