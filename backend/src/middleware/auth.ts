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
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.status(401).send({
                error: true,
                message: 'Missing or invalid authorization header',
                code: 'AUTH_FAILED',
            });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
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
