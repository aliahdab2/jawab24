import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { authService } from '../services/auth';

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
 * Middleware to validation CSRF token
 * Required for all state-changing requests when using cookies
 */
export async function csrfProtection(request: FastifyRequest, reply: FastifyReply) {
    // Skip for non-cookie auth (e.g. mobile using Bearer)
    if (request.headers.authorization) {
        return;
    }

    // Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        return;
    }

    // Skip for unauthenticated requests (no auth cookie = not logged in via cookies)
    // CSRF only matters for cookie-authenticated sessions
    // Note: request.cookies may be undefined if cookie plugin hasn't parsed yet
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
