import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import { AppError, ValidationError } from '../utils/errors';
import { config } from '../config';
import { sanitizeBody } from '../utils/logSanitizer';

/**
 * Node/stream codes that all mean the same thing: the CLIENT went away before
 * the response finished. Nothing failed on our side and nothing is fixable here.
 */
const CLIENT_DISCONNECT_CODES = new Set([
    'ERR_STREAM_PREMATURE_CLOSE',
    'ERR_STREAM_DESTROYED',
    'ECONNRESET',
    'EPIPE',
]);

function isClientDisconnect(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException)?.code;
    return typeof code === 'string' && CLIENT_DISCONNECT_CODES.has(code);
}

/**
 * Global Error Handler for Fastify
 * Handles all errors consistently across the application
 */
export function errorHandler(
    error: FastifyError | AppError | Error,
    request: FastifyRequest,
    reply: FastifyReply
) {
    // The client closed the connection mid-response. Carries no statusCode, so
    // it used to fall through to the 500 branch below and be reported to Sentry
    // as a server error — while the response had ALREADY gone out as 200.
    //
    // Seen in production on POST /pages/:id/connect-whatsapp (Sentry
    // JAWAB24-BACKEND-1H, 2026-07-27): the Embedded Signup popup closes the
    // instant Meta hands back the auth code, which tears the socket down while
    // @fastify/compress is still streaming the reply. The connect had succeeded.
    //
    // Left as an error it would fire on EVERY successful WhatsApp connect once
    // this opens beyond the canary — a permanent false alarm that teaches people
    // to ignore Sentry. Log it and stop: the socket is gone, so attempting to
    // send a body would only raise ERR_STREAM_DESTROYED on top of it.
    if (isClientDisconnect(error)) {
        request.log.info({
            requestId: request.id,
            url: request.url,
            method: request.method,
            code: (error as NodeJS.ErrnoException).code,
        }, 'Client disconnected before the response completed');
        return;
    }

    // Log error
    request.log.error({
        err: error,
        requestId: request.id,
        url: request.url,
        method: request.method,
    }, 'Request error');

    // Send to Sentry (only for 500 errors, not validation/auth errors)
    const statusCode = (error as FastifyError).statusCode || (error as AppError).statusCode || 500;
    if (statusCode >= 500) {
        Sentry.captureException(error, {
            extra: {
                requestId: request.id,
                url: request.url,
                method: request.method,
                body: sanitizeBody(request.body),
            },
        });
    }

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
    const isProduction = config.nodeEnv === 'production';
    
    return reply.status(500).send({
        error: true,
        message: isProduction ? 'Internal server error' : error.message,
        code: 'INTERNAL_ERROR',
        ...(!isProduction && { stack: error.stack }),
    });
}

