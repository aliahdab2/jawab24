import { FastifyReply } from 'fastify';
import crypto from 'crypto';
import { config } from '../config';

const TOKEN_EXPIRY_MS = 15 * 60 * 1000;                // 15 min — must match ACCESS_TOKEN_EXPIRY in auth.ts
const REFRESH_TOKEN_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000; // 60 days — must match refreshToken.ts

const isProduction = config.nodeEnv === 'production';

// Cookie configuration
export const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/',
    signed: true,
};

// CSRF Cookie options (must be accessible to JS)
export const CSRF_COOKIE_OPTIONS = {
    ...COOKIE_OPTIONS,
    httpOnly: false, // JS needs to read this to send in header
    signed: false,   // No need to sign, it's a random token
};

// Refresh Token Cookie options
// Path must stay at '/' because the browser sees the request as `/api/auth/refresh`
// (nginx rewrites `/api/*` → `/*` before the backend). A narrower Path like
// `/auth/refresh` makes the browser drop the cookie on every refresh attempt.
// HttpOnly + signed already protect the value; path-narrowing was only defense-in-depth.
export const REFRESH_COOKIE_OPTIONS = {
    ...COOKIE_OPTIONS,
    path: '/',
};

// Shopify pending install cookie (lax sameSite for cross-site redirect from Shopify)
export const PENDING_SHOPIFY_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,  // MUST be 'lax' — Shopify redirects cross-site
    path: '/',
    signed: true,
    maxAge: 30 * 60,  // 30 minutes
};

// Shopify OAuth nonce cookie (CSRF protection during OAuth round-trip)
export const SHOPIFY_NONCE_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    signed: true,
    maxAge: 10 * 60,  // 10 minutes
};

// Salla pending install cookie (lax sameSite for cross-site redirect from Salla)
export const PENDING_SALLA_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    signed: true,
    maxAge: 30 * 60,  // 30 minutes
};

// Salla OAuth nonce cookie (CSRF protection during OAuth round-trip)
export const SALLA_NONCE_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    signed: true,
    maxAge: 10 * 60,  // 10 minutes
};

// Zid pending install cookie (lax sameSite for cross-site redirect from Zid)
export const PENDING_ZID_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    signed: true,
    maxAge: 30 * 60,  // 30 minutes
};

// Zid OAuth nonce cookie (CSRF protection during OAuth round-trip)
export const ZID_NONCE_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    signed: true,
    maxAge: 10 * 60,  // 10 minutes
};

// WhatsApp connect OAuth nonce cookie (CSRF protection during the redirect
// Embedded Signup round-trip; must survive the cross-site 302 from facebook.com
// → sameSite lax). Lifetime matches WHATSAPP_STATE_TTL_MS — 30 minutes, because
// the round-trip includes the merchant WALKING META'S WHOLE WIZARD (business
// creation, number, OTP…); a shorter window expires mid-signup and discards
// completed work at the callback.
export const WHATSAPP_NONCE_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    signed: true,
    maxAge: 30 * 60,  // 30 minutes
};

export class CookiesService {
    /**
     * Set authentication cookies
     */
    setAuthCookies(reply: FastifyReply, token: string): void {
        const csrfToken = crypto.randomBytes(32).toString('hex');
        
        // Main auth token (HttpOnly)
        reply.setCookie('token', token, {
            ...COOKIE_OPTIONS,
            maxAge: TOKEN_EXPIRY_MS / 1000,
        });

        // CSRF token (JS accessible) — matches access-token cookie lifetime
        reply.setCookie('csrfToken', csrfToken, {
            ...CSRF_COOKIE_OPTIONS,
            maxAge: TOKEN_EXPIRY_MS / 1000,
        });
    }

    /**
     * Set refresh token cookie
     */
    setRefreshTokenCookie(reply: FastifyReply, token: string): void {
        reply.setCookie('refreshToken', token, {
            ...REFRESH_COOKIE_OPTIONS,
            maxAge: REFRESH_TOKEN_EXPIRY_MS / 1000,
        });
    }

    /**
     * Clear ONLY the refresh cookie, leaving the access session intact.
     *
     * For a session that is deliberately non-renewable: a scoped embedded
     * break-out keeps its short-lived access token but must not be able to
     * rotate through /auth/refresh, which mints UNSCOPED. Distinct from
     * clearAuthCookies, which ends the session outright.
     */
    clearRefreshTokenCookie(reply: FastifyReply): void {
        reply.clearCookie('refreshToken', { ...REFRESH_COOKIE_OPTIONS });
    }

    /**
     * Clear authentication cookies
     */
    clearAuthCookies(reply: FastifyReply): void {
        reply.clearCookie('token', { ...COOKIE_OPTIONS, path: '/' });
        reply.clearCookie('csrfToken', { ...CSRF_COOKIE_OPTIONS, path: '/' });
        reply.clearCookie('refreshToken', { ...REFRESH_COOKIE_OPTIONS });
    }
}

export const cookiesService = new CookiesService();
