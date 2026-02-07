import { describe, it, expect } from 'vitest';
import {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    InternalServerError,
    DatabaseError,
    ExternalServiceError,
} from '../../src/utils/errors';

describe('Custom error classes', () => {
    describe('AppError', () => {
        it('should set statusCode, code, and message', () => {
            const err = new AppError('Something went wrong', 502, 'BAD_GATEWAY');
            expect(err.message).toBe('Something went wrong');
            expect(err.statusCode).toBe(502);
            expect(err.code).toBe('BAD_GATEWAY');
            expect(err.isOperational).toBe(true);
        });

        it('should be an instance of Error', () => {
            const err = new AppError('test', 500, 'TEST');
            expect(err).toBeInstanceOf(Error);
            expect(err).toBeInstanceOf(AppError);
        });

        it('should allow non-operational flag', () => {
            const err = new AppError('crash', 500, 'CRASH', false);
            expect(err.isOperational).toBe(false);
        });

        it('should capture a stack trace', () => {
            const err = new AppError('stack', 500, 'STACK');
            expect(err.stack).toBeDefined();
            expect(err.stack).toContain('errors.test.ts');
        });
    });

    describe('ValidationError', () => {
        it('should default to 400 and VALIDATION_ERROR code', () => {
            const err = new ValidationError('bad input');
            expect(err.statusCode).toBe(400);
            expect(err.code).toBe('VALIDATION_ERROR');
        });

        it('should attach details when provided', () => {
            const details = [{ path: 'email', message: 'invalid' }];
            const err = new ValidationError('bad input', details);
            expect(err.details).toEqual(details);
        });

        it('should have no details when not provided', () => {
            const err = new ValidationError('bad input');
            expect(err.details).toBeUndefined();
        });
    });

    describe('AuthenticationError', () => {
        it('should default to 401 with default message', () => {
            const err = new AuthenticationError();
            expect(err.statusCode).toBe(401);
            expect(err.code).toBe('AUTH_ERROR');
            expect(err.message).toBe('Authentication failed');
        });

        it('should accept custom message', () => {
            const err = new AuthenticationError('Token expired');
            expect(err.message).toBe('Token expired');
        });
    });

    describe('AuthorizationError', () => {
        it('should default to 403', () => {
            const err = new AuthorizationError();
            expect(err.statusCode).toBe(403);
            expect(err.code).toBe('FORBIDDEN');
            expect(err.message).toBe('Insufficient permissions');
        });
    });

    describe('NotFoundError', () => {
        it('should default to 404', () => {
            const err = new NotFoundError();
            expect(err.statusCode).toBe(404);
            expect(err.code).toBe('NOT_FOUND');
        });
    });

    describe('ConflictError', () => {
        it('should default to 409', () => {
            const err = new ConflictError();
            expect(err.statusCode).toBe(409);
            expect(err.code).toBe('CONFLICT');
        });
    });

    describe('RateLimitError', () => {
        it('should default to 429', () => {
            const err = new RateLimitError();
            expect(err.statusCode).toBe(429);
            expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
        });
    });

    describe('InternalServerError', () => {
        it('should default to 500 and be non-operational', () => {
            const err = new InternalServerError();
            expect(err.statusCode).toBe(500);
            expect(err.code).toBe('INTERNAL_ERROR');
            expect(err.isOperational).toBe(false);
        });
    });

    describe('DatabaseError', () => {
        it('should default to 500 and be non-operational', () => {
            const err = new DatabaseError();
            expect(err.statusCode).toBe(500);
            expect(err.code).toBe('DATABASE_ERROR');
            expect(err.isOperational).toBe(false);
        });
    });

    describe('ExternalServiceError', () => {
        it('should default to 503 with service name', () => {
            const err = new ExternalServiceError('Facebook');
            expect(err.statusCode).toBe(503);
            expect(err.code).toBe('EXTERNAL_SERVICE_ERROR');
            expect(err.message).toBe('Facebook service unavailable');
            expect(err.isOperational).toBe(false);
        });

        it('should accept custom message', () => {
            const err = new ExternalServiceError('Stripe', 'Payment gateway down');
            expect(err.message).toBe('Payment gateway down');
        });
    });
});
