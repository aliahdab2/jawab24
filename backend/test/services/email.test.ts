import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config', () => ({
    config: {
        resend: {
            apiKey: 'test_resend_key',
            fromEmail: 'test@jawab24.com',
            fromName: 'Jawab24 Test',
        },
    },
}));

import { EmailService } from '../../src/services/email';
import type { Logger } from '../../src/types/logger';

function mockLogger(): Logger {
    return {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
    };
}

describe('EmailService', () => {
    let emailService: EmailService;
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
        emailService = new EmailService();
        vi.resetAllMocks();
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    describe('development mode', () => {
        it('should log and return dev-mode id without calling Resend', async () => {
            process.env.NODE_ENV = 'development';
            const logger = mockLogger();
            emailService.setLogger(logger);

            const fetchSpy = vi.spyOn(global, 'fetch');

            const result = await emailService.send({
                to: 'user@example.com',
                subject: 'Test',
                html: '<p>Hello</p>',
            });

            expect(result).toEqual({ success: true, id: 'dev-mode' });
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith('Email (dev)', {
                to: 'user@example.com',
                subject: 'Test',
            });
        });
    });

    describe('production mode', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'test';
        });

        it('should call Resend API with correct payload', async () => {
            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({ id: 'resend_123' }),
            };
            vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

            const result = await emailService.send({
                to: 'user@example.com',
                subject: 'Welcome',
                html: '<p>Hello</p>',
            });

            expect(result).toEqual({ success: true, id: 'resend_123' });
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.resend.com/emails',
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer test_resend_key',
                    },
                    body: JSON.stringify({
                        from: 'Jawab24 Test <test@jawab24.com>',
                        to: ['user@example.com'],
                        subject: 'Welcome',
                        html: '<p>Hello</p>',
                    }),
                })
            );
        });

        it('should return error on non-ok response', async () => {
            const mockResponse = {
                ok: false,
                status: 422,
                json: vi.fn().mockResolvedValue({
                    statusCode: 422,
                    message: 'Invalid email address',
                    name: 'validation_error',
                }),
            };
            vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

            const result = await emailService.send({
                to: 'bad-email',
                subject: 'Test',
                html: '<p>Hi</p>',
            });

            expect(result).toEqual({ success: false, error: 'Invalid email address' });
        });

        it('should fallback to HTTP status when error message is empty', async () => {
            const mockResponse = {
                ok: false,
                status: 500,
                json: vi.fn().mockResolvedValue({
                    statusCode: 500,
                    message: '',
                    name: 'internal_error',
                }),
            };
            vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

            const result = await emailService.send({
                to: 'user@example.com',
                subject: 'Test',
                html: '<p>Hi</p>',
            });

            expect(result).toEqual({ success: false, error: 'HTTP 500' });
        });
    });

    describe('missing API key', () => {
        it('should warn and return error when RESEND_API_KEY is empty', async () => {
            process.env.NODE_ENV = 'test';
            const logger = mockLogger();

            // Re-mock config with empty apiKey
            const { config } = await import('../../src/config');
            const originalKey = config.resend.apiKey;
            config.resend.apiKey = '';

            emailService.setLogger(logger);
            const fetchSpy = vi.spyOn(global, 'fetch');

            const result = await emailService.send({
                to: 'user@example.com',
                subject: 'Test',
                html: '<p>Hi</p>',
            });

            expect(result).toEqual({ success: false, error: 'Email provider not configured' });
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith('Email not configured — RESEND_API_KEY is empty');

            // Restore
            config.resend.apiKey = originalKey;
        });
    });
});
