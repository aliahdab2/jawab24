import { FastifyRequest } from 'fastify';
import { authService } from '../services/auth';

/**
 * Attempts to extract a userId from the request without throwing.
 * Accepts both Bearer token (Authorization header) and signed cookie.
 * Returns null if no valid token is found — caller decides how to handle.
 */
export function tryGetUserId(request: FastifyRequest): string | null {
    try {
        let token: string | undefined;

        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (request.cookies.token) {
            const unsigned = request.unsignCookie(request.cookies.token);
            if (unsigned.valid && unsigned.value) {
                token = unsigned.value;
            } else {
                return null;
            }
        }

        if (!token) return null;

        const payload = authService.verifyToken(token);
        return payload?.userId || null;
    } catch {
        return null;
    }
}
