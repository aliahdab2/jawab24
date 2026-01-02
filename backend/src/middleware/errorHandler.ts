import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../utils/errors';

/**
 * Global Error Handler for Fastify
 * Handles all errors consistently across the application
 */
export function errorHandler(
    error: FastifyError | AppError | Error,
    request: FastifyRequest,
    reply: FastifyReply
) {
    // Log error
    request.log.error({
        err: error,
        requestId: (request as any).id,
        url: request.url,
        method: request.method,
    }, 'Request error');

    // Handle custom AppError
    if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
            error: true,
            message: error.message,
            code: error.code,
            ...(( error as any).details && { details: (error as any).details }),
        });
    }

    // Handle Fastify validation errors
    if ((error as FastifyError).validation) {
        return reply.status(400).send({
            error: true,
            message: 'Validation error',
            code: 'VALIDATION_ERROR',
            details: (error as FastifyError).validation,
        });
    }

    // Handle other Fastify errors
    if ((error as FastifyError).statusCode) {
        return reply.status((error as FastifyError).statusCode!).send({
            error: true,
            message: error.message,
            code: (error as any).code || 'ERROR',
        });
    }

    // Default to 500 for unknown errors
    // Don't expose internal error details in production
    const isProduction = process.env.NODE_ENV === 'production';
    
    return reply.status(500).send({
        error: true,
        message: isProduction ? 'Internal server error' : error.message,
        code: 'INTERNAL_ERROR',
        ...(!isProduction && { stack: error.stack }),
    });
}

