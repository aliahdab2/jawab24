import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

/**
 * Request ID Middleware
 * Adds a unique ID to each request for tracing and debugging
 * Note: Fastify already provides request.id, this middleware just ensures it's also in headers
 */
export async function requestIdMiddleware(request: FastifyRequest, reply: FastifyReply) {
    // Use existing request ID from header or the one Fastify generates
    const requestId = (request.headers['x-request-id'] as string) || request.id || crypto.randomUUID();
    
    // Add to response headers
    reply.header('x-request-id', requestId);
}
