import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

/**
 * Request ID Middleware
 * Adds a unique ID to each request for tracing and debugging
 */
export async function requestIdMiddleware(request: FastifyRequest, reply: FastifyReply) {
    // Use existing request ID from header or generate new one
    const requestId = (request.headers['x-request-id'] as string) || uuidv4();
    
    // Attach to request object
    (request as any).id = requestId;
    
    // Add to response headers
    reply.header('x-request-id', requestId);
}

