import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { AppError, ValidationError } from '../utils/errors';

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
        requestId: request.id,
        url: request.url,
        method: request.method,
    }, 'Request error');

    // Handle custom AppError
    if (error instanceof AppError) {
        const response: Record<string, unknown> = {
            error: true,
            message: error.message,
            code: error.code,
        };
        if (error instanceof ValidationError && error.details) {
            response.details = error.details;
        }
        return reply.status(error.statusCode).send(response);
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
        const fastifyError = error as FastifyError;
        return reply.status(fastifyError.statusCode ?? 500).send({
            error: true,
            message: error.message,
            code: fastifyError.code || 'ERROR',
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

