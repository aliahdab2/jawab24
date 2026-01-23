import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface AuthenticatedRequest extends FastifyRequest {
    user?: {
        userId: string;
        facebookId: string;
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

        // Attach user info to request
        request.user = {
            userId: payload.userId,
            facebookId: payload.facebookId,
        };
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

    const cookieToken = request.cookies.csrfToken;
    const headerToken = request.headers['x-csrf-token'];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
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
 * Checks the isAdmin flag on the user record
 */
export async function requireAdmin(request: AuthenticatedRequest, reply: FastifyReply) {
    // First ensure user is authenticated
    if (!request.user?.userId) {
        return reply.status(401).send({
            error: true,
            message: 'Authentication required',
            code: 'AUTH_REQUIRED',
        });
    }

    try {
        // Fetch user from database to check isAdmin flag
        const [user] = await db
            .select({ isAdmin: users.isAdmin })
            .from(users)
            .where(eq(users.id, request.user.userId))
            .limit(1);

        if (!user || !user.isAdmin) {
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

        // Attach isAdmin to request for downstream use
        request.user.isAdmin = true;
    } catch (error) {
        request.log.error(error, 'Failed to check admin status');
        return reply.status(500).send({
            error: true,
            message: 'Failed to verify admin status',
            code: 'ADMIN_CHECK_FAILED',
        });
    }
}
