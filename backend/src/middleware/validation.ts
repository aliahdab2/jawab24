import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../utils/errors';

/**
 * Middleware factory to validate request body using Zod schema
 */
export function validateBody<T extends z.ZodType>(schema: T) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            request.body = schema.parse(request.body);
        } catch (error) {
            if (error instanceof z.ZodError) {
                const validationError = new ValidationError(
                    'Request validation failed',
                    error.errors.map(err => ({
                        path: err.path.join('.'),
                        message: err.message,
                    }))
                );
                return reply.status(400).send({
                    error: true,
                    message: validationError.message,
                    code: 'VALIDATION_ERROR',
                    details: (validationError as any).details,
                });
            }
            throw error;
        }
    };
}

/**
 * Middleware factory to validate request params using Zod schema
 */
export function validateParams<T extends z.ZodType>(schema: T) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            request.params = schema.parse(request.params);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.status(400).send({
                    error: true,
                    message: 'Invalid request parameters',
                    code: 'VALIDATION_ERROR',
                    details: error.errors.map(err => ({
                        path: err.path.join('.'),
                        message: err.message,
                    })),
                });
            }
            throw error;
        }
    };
}

/**
 * Middleware factory to validate query parameters using Zod schema
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            request.query = schema.parse(request.query);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.status(400).send({
                    error: true,
                    message: 'Invalid query parameters',
                    code: 'VALIDATION_ERROR',
                    details: error.errors.map(err => ({
                        path: err.path.join('.'),
                        message: err.message,
                    })),
                });
            }
            throw error;
        }
    };
}

