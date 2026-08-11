import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { authService } from '../services/auth';
import { csrfInvalidCaptureMessage } from '../lib/sentry';
import type { EmbeddedPlatform } from '../types';

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
        /**
         * Set only for a RESTRICTED session minted for a platform dashboard
         * iframe (see TokenScope). Its presence means the caller proved the
         * STORE, not the person — requireAdmin rejects it, and resolveWorkspace
         * pins the session to `scopedWorkspaceId`.
         */
        embeddedPlatform?: EmbeddedPlatform;
        scopedWorkspaceId?: string;
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
            ...(payload.embeddedPlatform && { embeddedPlatform: payload.embeddedPlatform }),
            ...(payload.workspaceId && { scopedWorkspaceId: payload.workspaceId }),
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
 * request body — a Facebook OAuth `code`/access token, a phone OTP — or from
 * nothing at all (demo login mints a fresh demo session). None of them derive
 * authority from the session cookie, so CSRF is inapplicable and must not gate
 * them:
 *   - The OAuth code / OTP is itself the anti-forgery token: an attacker can't
 *     obtain a valid one for the victim, and the endpoint mints a fresh session
 *     from it, ignoring any ambient `token` cookie.
 *   - They are called from public pages before login, so a returning user whose
 *     browser still holds a lingering `token` cookie (but whose client doesn't
 *     attach X-CSRF-Token) would otherwise be 403'd out of logging in. This
 *     happened in production (2026-07-18): demo login, OTP request, and logout
 *     all returned 403 for visitors with a stale session cookie.
 *   - sameSite:strict on the `token` cookie stays the primary cross-site defense
 *     (a cross-site forged request cannot send it at all).
 *
 * `/auth/phone/link` is deliberately NOT here: it acts on the CURRENT session
 * (links a phone to the logged-in user) and rides the authenticated `api` client,
 * so it must keep CSRF (web) / Bearer-skip (app) like any other mutation.
 *
 * `/auth/logout` IS here on a different rationale (the standard logout-CSRF
 * exemption): it only destroys the session. A cross-site forged logout carries
 * no cookie at all (sameSite:strict), so it is a no-op; and the app must be able
 * to revoke its server session even though authManager clears localStorage
 * (dropping the Bearer) before the server call and can't read the cross-host
 * csrfToken cookie. Blocking it left refresh tokens unrevoked (prod 2026-07-18:
 * logout 403×3 in 48h).
 */
const CSRF_EXEMPT_ROUTES = new Set<string>([
    '/auth/facebook',
    '/auth/facebook/native',
    '/auth/facebook/link',
    '/auth/demo',
    '/auth/phone/request',
    '/auth/phone/verify',
    '/auth/logout',
    // Same one-time-credential rationale: the single-use handoff code IS the
    // anti-forgery token. /auth/sync calls it with raw axios (no X-CSRF-Token),
    // so a browser holding cookies from an EARLIER handoff was 403'd on every
    // retry (observed live 2026-07-30, "فشل المزامنة" on the owner's device).
    '/auth/browser-handoff/exchange',
    // Identical rationale for the platform embedded-app entry: the UUID in the
    // body IS the credential, the endpoint ignores any ambient cookie, and the
    // entry page calls it with raw axios (no X-CSRF-Token). Inside the iframe
    // the sameSite:strict cookie is never sent so this never mattered — but a
    // TOP-LEVEL open by a merchant who already has a cookie session sends it,
    // and without this line they get a 403 rendered as "Could not open the app".
    // Same failure shape as the two incidents above.
    '/zid/embedded/session',
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

    // A Bearer-authenticated request is never cookie-authenticated, so CSRF (a
    // defense against AMBIENT cookie credentials) does not apply. This mirrors
    // authenticate() exactly: it enters the Bearer branch — and never reads the
    // token cookie — iff the header starts with "Bearer ". A cross-site attacker
    // cannot attach this header (forms can't set Authorization; fetch requires a
    // CORS-allowlisted origin + preflight), so a Bearer request is not forgeable
    // through the ambient cookie. Matching authenticate()'s condition (not merely
    // "a header exists") keeps CSRF-skip <=> Bearer-auth with no gap: a malformed
    // non-Bearer Authorization header falls through to the cookie in authenticate(),
    // so it must NOT skip CSRF here.
    // (This is why the app — Bearer-authed but unable to read the cross-host
    // csrfToken cookie into a header — was being 403'd on every mutation.)
    if (request.headers.authorization?.startsWith('Bearer ')) {
        return;
    }

    // CSRF only matters for cookie-authenticated sessions. Past this point the
    // request has no Bearer header, so a `token` cookie (if any) is the auth source.
    // No cookie => unauthenticated (authenticate() will 401 it) — nothing to forge.
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
        // CSRF 403s were invisible until 2026-07-18 (demo/OTP/logout lockouts
        // found only via nginx logs). Group per route so a misbehaving client
        // class surfaces as one issue; distinguish "client sent nothing" from
        // a genuine mismatch — the former is almost always a client-wiring bug.
        const route = request.routeOptions?.url ?? request.url;
        Sentry.withScope((scope) => {
            scope.setFingerprint(['csrf-invalid', route]);
            scope.setLevel('warning');
            scope.setTag('route', route);
            scope.setExtra('ip', request.ip);
            scope.setExtra('hasCsrfCookie', Boolean(cookieToken));
            scope.setExtra('hasCsrfHeader', Boolean(headerToken));
            Sentry.captureMessage(csrfInvalidCaptureMessage(route));
        });
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

    // A restricted (embedded) session can never be admin — generateToken
    // force-clears the flag at mint time. Rejecting it explicitly here too is
    // deliberate belt-and-braces: this is the one check whose failure mode is
    // "attacker reaches the admin console", so it must not depend on a single
    // upstream line staying correct.
    if (request.user.embeddedPlatform) {
        request.log.warn({
            userId: request.user.userId,
            route: request.url,
            embeddedPlatform: request.user.embeddedPlatform,
        }, 'Admin access denied for embedded session');

        return reply.status(403).send({
            error: true,
            message: 'Admin privileges required',
            code: 'ADMIN_REQUIRED',
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
