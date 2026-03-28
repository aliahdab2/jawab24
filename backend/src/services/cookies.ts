import { FastifyReply } from 'fastify';
import crypto from 'crypto';
import { config } from '../config';

const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;      // 7 days  — access token cookie
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

// Refresh Token Cookie options (Strict path restriction)
export const REFRESH_COOKIE_OPTIONS = {
    ...COOKIE_OPTIONS,
    path: '/auth/refresh', // ONLY send to refresh endpoint
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

        // CSRF token (JS accessible)
        reply.setCookie('csrfToken', csrfToken, {
            ...CSRF_COOKIE_OPTIONS,
            maxAge: TOKEN_EXPIRY_MS / 1000, // Match access token (will be shorter now)
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
     * Clear authentication cookies
     */
    clearAuthCookies(reply: FastifyReply): void {
        reply.clearCookie('token', { ...COOKIE_OPTIONS, path: '/' });
        reply.clearCookie('csrfToken', { ...CSRF_COOKIE_OPTIONS, path: '/' });
        reply.clearCookie('refreshToken', { ...REFRESH_COOKIE_OPTIONS });
    }
}

export const cookiesService = new CookiesService();
