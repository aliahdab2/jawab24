import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { authService } from '../services/auth';

// In-memory throttle: avoid writing last_seen_at more than once per 2 minutes per user.
// Capped at 10,000 entries to prevent unbounded growth on long-running instances.
const lastSeenWritten = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 2 * 60 * 1000;
const LAST_SEEN_MAP_CAP = 10_000;

function touchLastSeen(userId: string): void {
    const now = Date.now();
    const last = lastSeenWritten.get(userId) ?? 0;
    if (now - last < LAST_SEEN_THROTTLE_MS) return;
    if (lastSeenWritten.size >= LAST_SEEN_MAP_CAP) lastSeenWritten.clear();
    lastSeenWritten.set(userId, now);
    db.update(users)
        .set({ lastSeenAt: new Date() })
        .where(eq(users.id, userId))
        .catch((err) => Sentry.captureException(err));
}

export interface AuthenticatedRequest extends FastifyRequest {
    user?: {
        userId: string;
        isAdmin?: boolean;
    };
}

/**
 * Middleware to authenticate requests using JWT
 */
export async function authenticate(request: AuthenticatedRequest, reply: FastifyReply) {
    try {
        let token = request.headers.authorization;

        // 1. Check Authorization header (Mobile/API)
        if (token && token.startsWith('Bearer ')) {
            token = token.substring(7);
        } 
        // 2. Check HttpOnly Cookie (Web)
        else if (request.cookies.token) {
            const unsigned = request.unsignCookie(request.cookies.token);
            if (unsigned.valid && unsigned.value) {
                token = unsigned.value;
            } else {
                // If signature validation fails, treat as no token
                // But if it's not signed (legacy/dev), maybe fallback? 
                // However, updated config says signed: true always.
                // We'll trust unsignCookie.
            }
        }

        if (!token) {
            return reply.status(401).send({
                error: true,
                message: 'Missing or invalid authorization header/cookie',
                code: 'AUTH_FAILED',
            });
        }

        const payload = authService.verifyToken(token);

        if (!payload) {
            return reply.status(401).send({
                error: true,
                message: 'Invalid or expired token',
                code: 'INVALID_TOKEN',
            });
        }

        // Attach user info to request (isAdmin cached in JWT, refreshed every 15 min)
        request.user = {
            userId: payload.userId,
            isAdmin: payload.isAdmin || false,
        };

        // Set Sentry user context so every error in this request is linked to the user
        Sentry.setUser({ id: payload.userId });

        // Stamp last_seen_at (throttled — max 1 DB write per 2 minutes per user)
        // Isolated try/catch: last_seen_at is non-critical and must never fail auth
        try { touchLastSeen(payload.userId); } catch { /* non-critical */ }
    } catch (error) {
        request.log.error(error);
        return reply.status(401).send({
            error: true,
            message: 'Authentication failed',
            code: 'AUTH_FAILED',
        });
    }
}

/**
 * Auth endpoints that (re)establish identity from a one-time credential in the
 * request body — a Facebook OAuth `code` or access token — NOT from the session
 * cookie. CSRF is inapplicable here and must not gate them:
 *   - The OAuth code is itself the anti-forgery token: an attacker can't obtain a
 *     valid one for the victim, and the endpoint mints a fresh session from it,
 *     ignoring any ambient `token` cookie.
 *   - They are called from the /auth/callback page via raw `fetch` (not the axios
 *     client that attaches X-CSRF-Token), so a returning user whose browser still
 *     holds a valid `token` cookie would otherwise be 403'd out of logging in.
 *   - sameSite:strict on the `token` cookie stays the primary cross-site defense
 *     (a cross-site forged request cannot send it at all).
 */
const CSRF_EXEMPT_ROUTES = new Set<string>([
    '/auth/facebook',
    '/auth/facebook/native',
    '/auth/facebook/link',
]);

/**
 * Middleware to validation CSRF token
 * Required for all state-changing requests when using cookies
 */
export async function csrfProtection(request: FastifyRequest, reply: FastifyReply) {
    // Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        return;
    }

    // Skip for auth OAuth-exchange endpoints (see CSRF_EXEMPT_ROUTES). routeOptions.url
    // is the matched route pattern, so query strings never interfere.
    if (CSRF_EXEMPT_ROUTES.has(request.routeOptions?.url ?? '')) {
        return;
    }

    // CSRF only matters for cookie-authenticated sessions. If there is no auth cookie,
    // the request is either pure Bearer (mobile/API) or unauthenticated — skip.
    // Auth-source priority: enforce CSRF whenever the cookie is present, even if an
    // Authorization header is also sent. The header alone must NOT short-circuit CSRF,
    // because cookie auth is still a valid auth source server-side and the cookie rides
    // the request automatically.
    // Note: request.cookies may be undefined if cookie plugin hasn't parsed yet.
    if (!request.cookies?.token) {
        return;
    }

    const cookieToken = request.cookies.csrfToken;
    const headerToken = request.headers['x-csrf-token'];

    if (!cookieToken || !headerToken
        || typeof headerToken !== 'string'
        || cookieToken.length !== headerToken.length
        || !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
        return reply.status(403).send({
            error: true,
            message: 'Invalid CSRF token',
            code: 'CSRF_INVALID',
        });
    }
}

/**
 * Middleware to require admin privileges
 * Must be used AFTER authenticate middleware
 * Uses isAdmin from JWT payload (cached, refreshed on token rotation every 15 min)
 */
export async function requireAdmin(request: AuthenticatedRequest, reply: FastifyReply) {
    if (!request.user?.userId) {
        return reply.status(401).send({
            error: true,
            message: 'Authentication required',
            code: 'AUTH_REQUIRED',
        });
    }

    if (!request.user.isAdmin) {
        request.log.warn({
            userId: request.user.userId,
            route: request.url,
        }, 'Admin access denied');

        return reply.status(403).send({
            error: true,
            message: 'Admin privileges required',
            code: 'ADMIN_REQUIRED',
        });
    }
}
