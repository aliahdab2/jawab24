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

const captureErrorMock = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => captureErrorMock(...args),
}));

// Capture the values passed into db.insert(emailSends).values(...) so tests
// can assert what we wrote to the audit log.
const insertValuesMock = vi.fn();
const returningMock = vi.fn();
vi.mock('../../src/db', () => ({
    db: {
        insert: () => ({
            values: (row: unknown) => {
                insertValuesMock(row);
                return { returning: () => returningMock() };
            },
        }),
    },
}));
vi.mock('../../src/db/schema', () => ({
    emailSends: { id: 'id' },
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

function okResponse(json: unknown) {
    return { ok: true, json: vi.fn().mockResolvedValue(json) } as unknown as Response;
}
function errResponse(status: number, json: unknown) {
    return { ok: false, status, json: vi.fn().mockResolvedValue(json) } as unknown as Response;
}

describe('EmailService', () => {
    let emailService: EmailService;
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
        emailService = new EmailService();
        vi.resetAllMocks();
        captureErrorMock.mockReset();
        insertValuesMock.mockReset();
        // Default: db.insert(...).values(...).returning() resolves to one row.
        returningMock.mockResolvedValue([{ id: 'email-send-row-uuid' }]);
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    describe('development mode', () => {
        it('returns dev-mode id without calling Resend or writing to email_sends', async () => {
            process.env.NODE_ENV = 'development';
            const logger = mockLogger();
            emailService.setLogger(logger);
            const fetchSpy = vi.spyOn(global, 'fetch');

            const result = await emailService.send({
                to: 'user@example.com',
                subject: 'Test',
                html: '<p>Hello</p>',
                type: 'transactional',
            });

            expect(result).toEqual({ success: true, id: 'dev-mode' });
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(insertValuesMock).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith('Email (dev)', {
                to: 'user@example.com',
                subject: 'Test',
                type: 'transactional',
            });
        });
    });

    describe('production send', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'test';
        });

        it('calls Resend with the correct payload, persists a sent audit row, and returns both ids', async () => {
            vi.spyOn(global, 'fetch').mockResolvedValue(okResponse({ id: 'resend_123' }));

            const result = await emailService.send({
                to: 'user@example.com',
                subject: 'Welcome',
                html: '<p>Hello</p>',
                type: 'lead_digest',
                userId: 'user-1',
            });

            expect(result).toEqual({
                success: true,
                id: 'resend_123',
                emailSendId: 'email-send-row-uuid',
            });
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.resend.com/emails',
                expect.objectContaining({ method: 'POST' }),
            );
            expect(insertValuesMock).toHaveBeenCalledTimes(1);
            const audit = insertValuesMock.mock.calls[0][0];
            expect(audit).toMatchObject({
                type: 'lead_digest',
                toEmail: 'user@example.com',
                subject: 'Welcome',
                htmlBody: '<p>Hello</p>',
                status: 'sent',
                resendEmailId: 'resend_123',
                userId: 'user-1',
                errorMessage: null,
            });
        });

        it('persists a failed audit row when Resend returns a non-ok response and reports captureError', async () => {
            vi.spyOn(global, 'fetch').mockResolvedValue(errResponse(422, {
                statusCode: 422,
                message: 'Invalid email address',
                name: 'validation_error',
            }));

            const result = await emailService.send({
                to: 'bad-email',
                subject: 'Test',
                html: '<p>Hi</p>',
                type: 'transactional',
            });

            expect(result).toEqual({
                success: false,
                error: 'Invalid email address',
                emailSendId: 'email-send-row-uuid',
            });
            expect(insertValuesMock).toHaveBeenCalledTimes(1);
            expect(insertValuesMock.mock.calls[0][0]).toMatchObject({
                status: 'failed',
                errorMessage: 'Invalid email address',
                resendEmailId: null,
            });
            expect(captureErrorMock).toHaveBeenCalledWith(
                expect.any(Error),
                'email.send Resend API failure',
                expect.objectContaining({
                    tags: expect.objectContaining({ service: 'email', statusCode: '422' }),
                }),
            );
        });

        it('falls back to "HTTP <status>" when Resend returns an empty error message', async () => {
            vi.spyOn(global, 'fetch').mockResolvedValue(errResponse(500, {
                statusCode: 500,
                message: '',
                name: 'internal_error',
            }));

            const result = await emailService.send({
                to: 'user@example.com',
                subject: 'Test',
                html: '<p>Hi</p>',
                type: 'transactional',
            });

            expect(result.error).toBe('HTTP 500');
            expect(insertValuesMock.mock.calls[0][0].errorMessage).toBe('HTTP 500');
        });

        it('replaces oversized html bodies with a marker so one bad row cannot bloat email_sends', async () => {
            vi.spyOn(global, 'fetch').mockResolvedValue(okResponse({ id: 'resend_big' }));
            const huge = '<p>' + 'x'.repeat(600_000) + '</p>';

            await emailService.send({
                to: 'user@example.com',
                subject: 'Big email',
                html: huge,
                type: 'lead_digest',
            });

            const audit = insertValuesMock.mock.calls[0][0];
            expect(audit.htmlBody).toMatch(/<!-- body omitted/);
            expect(audit.htmlBody.length).toBeLessThan(huge.length);
        });

        it('still returns success when audit-log insert throws (audit failure must not block delivery)', async () => {
            vi.spyOn(global, 'fetch').mockResolvedValue(okResponse({ id: 'resend_777' }));
            returningMock.mockRejectedValueOnce(new Error('DB down'));

            const result = await emailService.send({
                to: 'user@example.com',
                subject: 'Test',
                html: '<p>Hi</p>',
                type: 'transactional',
            });

            expect(result.success).toBe(true);
            expect(result.id).toBe('resend_777');
            expect(result.emailSendId).toBeUndefined();
            expect(captureErrorMock).toHaveBeenCalledWith(
                expect.any(Error),
                'Failed to write email_sends row',
                expect.objectContaining({ tags: expect.objectContaining({ service: 'email' }) }),
            );
        });
    });

    describe('missing API key', () => {
        it('warns, persists a failed audit row, and returns an error', async () => {
            process.env.NODE_ENV = 'test';
            const logger = mockLogger();

            const { config } = await import('../../src/config');
            const originalKey = config.resend.apiKey;
            config.resend.apiKey = '';

            emailService.setLogger(logger);
            const fetchSpy = vi.spyOn(global, 'fetch');

            const result = await emailService.send({
                to: 'user@example.com',
                subject: 'Test',
                html: '<p>Hi</p>',
                type: 'transactional',
            });

            expect(result).toEqual({
                success: false,
                error: 'Email provider not configured',
                emailSendId: 'email-send-row-uuid',
            });
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith('Email not configured — RESEND_API_KEY is empty');
            expect(captureErrorMock).toHaveBeenCalledWith(
                expect.any(Error),
                'email.send skipped — RESEND_API_KEY missing',
                expect.objectContaining({ tags: { service: 'email' }, level: 'error' }),
            );
            expect(insertValuesMock.mock.calls[0][0]).toMatchObject({
                status: 'failed',
                errorMessage: 'Email provider not configured',
            });

            config.resend.apiKey = originalKey;
        });
    });
});
