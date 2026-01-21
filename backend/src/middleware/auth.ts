import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth';

export interface AuthenticatedRequest extends FastifyRequest {
    user?: {
        userId: string;
        facebookId: string;
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
