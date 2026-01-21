import { FastifyReply } from 'fastify';
import crypto from 'crypto';

const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Cookie configuration
export const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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
         const REFRESH_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
         reply.setCookie('refreshToken', token, {
            ...REFRESH_COOKIE_OPTIONS,
            maxAge: REFRESH_EXPIRY_MS / 1000,
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
