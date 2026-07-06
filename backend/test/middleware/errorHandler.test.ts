import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply, FastifyError } from 'fastify';

// Mock Sentry before imports
vi.mock('@sentry/node', () => ({
    captureException: vi.fn(),
}));

vi.mock('../../src/config', () => ({
    config: {
        nodeEnv: 'test',
    },
}));

vi.mock('../../src/utils/errors', async () => {
    // Use real implementations for the error classes
    class AppError extends Error {
        public readonly statusCode: number;
        public readonly code: string;
        public readonly isOperational: boolean;
        constructor(message: string, statusCode: number, code: string, isOperational = true) {
            super(message);
            this.statusCode = statusCode;
            this.code = code;
            this.isOperational = isOperational;
            Error.captureStackTrace(this, this.constructor);
        }
    }

    class ValidationError extends AppError {
        public readonly details?: Array<{ path: string; message: string }>;
        constructor(message: string, details?: Array<{ path: string; message: string }>) {
            super(message, 400, 'VALIDATION_ERROR');
            if (details) {
                this.details = details;
            }
        }
    }

    return { AppError, ValidationError };
});

import { errorHandler } from '../../src/middleware/errorHandler';
import * as Sentry from '@sentry/node';
import { AppError, ValidationError } from '../../src/utils/errors';
import { config } from '../../src/config';

describe('errorHandler middleware', () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequest = {
            id: 'req-123',
            url: '/api/test',
            method: 'GET',
            body: { foo: 'bar' },
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        } as any;
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
    });

    it('should log every error with request context', () => {
        const error = new Error('something broke');
        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockRequest.log!.error).toHaveBeenCalledWith(
            expect.objectContaining({
                err: error,
                requestId: 'req-123',
                url: '/api/test',
                method: 'GET',
            }),
            'Request error',
        );
    });

    // ─── Sentry ───────────────────────────────────────────

    it('should send 500 errors to Sentry', () => {
        const error = new Error('server crash');
        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(Sentry.captureException).toHaveBeenCalledWith(error, {
            extra: expect.objectContaining({
                requestId: 'req-123',
                url: '/api/test',
            }),
        });
    });

    it('should NOT send 4xx errors to Sentry', () => {
        const error = new AppError('bad request', 400, 'BAD_REQUEST');
        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('should redact credential-bearing body fields before sending to Sentry', () => {
        (mockRequest as any).body = {
            email: 'user@example.com',
            password: 'hunter2',
            otp: '123456',
            code: 'oauth-code',
            accessToken: 'ya29.secret',
            keep: 'visible',
        };
        const error = new Error('server crash');
        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        const call = vi.mocked(Sentry.captureException).mock.calls[0];
        const body = (call[1] as any).extra.body;
        expect(body.password).toBe('[REDACTED]');
        expect(body.otp).toBe('[REDACTED]');
        expect(body.code).toBe('[REDACTED]');
        expect(body.accessToken).toBe('[REDACTED]'); // matches substring "token"
        expect(body.email).toBe('user@example.com'); // non-sensitive preserved
        expect(body.keep).toBe('visible');
    });

    // ─── AppError ─────────────────────────────────────────

    it('should handle AppError with correct status and code', () => {
        const error = new AppError('Not found', 404, 'NOT_FOUND');
        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(404);
        expect(mockReply.send).toHaveBeenCalledWith({
            error: true,
            message: 'Not found',
            code: 'NOT_FOUND',
        });
    });

    it('should include details for ValidationError', () => {
        const details = [{ path: 'email', message: 'Invalid email' }];
        const error = new ValidationError('Validation failed', details);
        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith({
            error: true,
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details,
        });
    });

    // ─── Fastify validation errors ────────────────────────

    it('should handle Fastify validation errors (schema failures)', () => {
        const error = {
            validation: [{ keyword: 'required', params: { missingProperty: 'name' } }],
            message: 'body must have required property name',
        } as unknown as FastifyError;

        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({
                error: true,
                code: 'VALIDATION_ERROR',
                details: error.validation,
            }),
        );
    });

    // ─── Fastify errors with statusCode ───────────────────

    it('should handle Fastify errors with statusCode', () => {
        const error = {
            statusCode: 413,
            code: 'FST_ERR_CTP_BODY_TOO_LARGE',
            message: 'Request body is too large',
        } as FastifyError;

        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(413);
        expect(mockReply.send).toHaveBeenCalledWith({
            error: true,
            message: 'Request body is too large',
            code: 'FST_ERR_CTP_BODY_TOO_LARGE',
        });
    });

    it('should use ERROR code when Fastify error has no code', () => {
        const error = {
            statusCode: 429,
            message: 'Rate limited',
        } as FastifyError;

        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(429);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'ERROR' }),
        );
    });

    // ─── Unknown errors ──────────────────────────────────

    it('should return 500 with message in non-production', () => {
        const origEnv = config.nodeEnv;
        (config as any).nodeEnv = 'test';

        const error = new Error('raw crash');
        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({
                error: true,
                message: 'raw crash',
                code: 'INTERNAL_ERROR',
            }),
        );

        (config as any).nodeEnv = origEnv;
    });

    it('should hide error message in production', () => {
        const origEnv = config.nodeEnv;
        (config as any).nodeEnv = 'production';

        const error = new Error('secret DB password leaked');
        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({
                error: true,
                message: 'Internal server error',
                code: 'INTERNAL_ERROR',
            }),
        );

        (config as any).nodeEnv = origEnv;
    });

    it('should include stack trace in non-production', () => {
        const origEnv = config.nodeEnv;
        (config as any).nodeEnv = 'development';

        const error = new Error('debug me');
        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        const sendCall = (mockReply.send as any).mock.calls[0][0];
        expect(sendCall.stack).toBeDefined();

        (config as any).nodeEnv = origEnv;
    });

    it('should NOT include stack trace in production', () => {
        const origEnv = config.nodeEnv;
        (config as any).nodeEnv = 'production';

        const error = new Error('no stack for you');
        errorHandler(error, mockRequest as FastifyRequest, mockReply as FastifyReply);

        const sendCall = (mockReply.send as any).mock.calls[0][0];
        expect(sendCall.stack).toBeUndefined();

        (config as any).nodeEnv = origEnv;
    });
});
