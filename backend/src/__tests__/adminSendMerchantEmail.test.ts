import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError, ExternalServiceError } from '../utils/errors';

// JWT_SECRET keys config, loaded transitively via emailTemplates → config.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret';

// db.select(...).from(...).where(...).limit() resolves to the staged user rows;
// db.insert(...).values(...) is the audit-log write (resolves, or rejects to
// exercise the swallow path).
const { mockLimit, mockValues, mockSend } = vi.hoisted(() => ({
    mockLimit: vi.fn(),
    mockValues: vi.fn(),
    mockSend: vi.fn(),
}));

vi.mock('../db', () => {
    const selectChain: Record<string, ReturnType<typeof vi.fn>> = {
        from: vi.fn(),
        where: vi.fn(),
        limit: mockLimit,
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    return {
        db: {
            select: vi.fn().mockReturnValue(selectChain),
            insert: vi.fn().mockReturnValue({ values: mockValues }),
        },
    };
});

vi.mock('../services/email', () => ({ emailService: { send: mockSend } }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { adminUsersService } from '../services/admin/users';

const ADMIN_ID = 'admin-1';
const USER_ID = 'user-1';

beforeEach(() => {
    mockLimit.mockReset();
    mockValues.mockReset().mockResolvedValue(undefined);
    mockSend.mockReset().mockResolvedValue({ success: true, emailSendId: 'es-1' });
});

describe('adminUsersService.sendMerchantEmail', () => {
    it('throws NotFoundError (404) when the user does not exist', async () => {
        mockLimit.mockResolvedValueOnce([]);
        await expect(
            adminUsersService.sendMerchantEmail(USER_ID, { subject: 's', body: 'b' }, ADMIN_ID),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('throws ValidationError (400) when the merchant has no email', async () => {
        mockLimit.mockResolvedValueOnce([{ id: USER_ID, email: null, name: 'متجر' }]);
        await expect(
            adminUsersService.sendMerchantEmail(USER_ID, { subject: 's', body: 'b' }, ADMIN_ID),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('throws ExternalServiceError (502) when delivery fails', async () => {
        mockLimit.mockResolvedValueOnce([{ id: USER_ID, email: 'm@x.com', name: 'متجر' }]);
        mockSend.mockResolvedValueOnce({ success: false, error: 'Resend down' });
        await expect(
            adminUsersService.sendMerchantEmail(USER_ID, { subject: 's', body: 'b' }, ADMIN_ID),
        ).rejects.toBeInstanceOf(ExternalServiceError);
        expect(mockValues).not.toHaveBeenCalled(); // no audit row on a failed send
    });

    it('sends as account_notice with userId, audits subject+body, returns emailSendId', async () => {
        mockLimit.mockResolvedValueOnce([{ id: USER_ID, email: 'm@x.com', name: 'متجر' }]);
        const result = await adminUsersService.sendMerchantEmail(
            USER_ID, { subject: 'Reconnect', body: 'Your page dropped' }, ADMIN_ID,
        );
        expect(result).toEqual({ emailSendId: 'es-1' });

        const sent = mockSend.mock.calls[0][0];
        expect(sent.to).toBe('m@x.com');
        expect(sent.type).toBe('account_notice');
        expect(sent.userId).toBe(USER_ID);
        expect(typeof sent.html).toBe('string');

        const audit = mockValues.mock.calls[0][0];
        expect(audit.action).toBe('merchant_email_sent');
        expect(audit.targetUserId).toBe(USER_ID);
        expect(audit.newValue).toEqual({ subject: 'Reconnect', body: 'Your page dropped' });
    });

    it('leaves cc/bcc/attachments undefined when the admin supplied none', async () => {
        mockLimit.mockResolvedValueOnce([{ id: USER_ID, email: 'm@x.com', name: 'متجر' }]);
        await adminUsersService.sendMerchantEmail(USER_ID, { subject: 's', body: 'b' }, ADMIN_ID);

        const sent = mockSend.mock.calls[0][0];
        expect(sent.cc).toBeUndefined();
        expect(sent.bcc).toBeUndefined();
        expect(sent.attachments).toBeUndefined();
    });

    it('passes cc, bcc and attachments through to the email transport', async () => {
        mockLimit.mockResolvedValueOnce([{ id: USER_ID, email: 'm@x.com', name: 'متجر' }]);
        await adminUsersService.sendMerchantEmail(
            USER_ID,
            {
                subject: 'Invoice',
                body: 'Attached',
                cc: ['info@jawab24.com'],
                bcc: ['rep@example.com'],
                attachments: [{ filename: 'invoice.pdf', content: 'QUFB' }],
            },
            ADMIN_ID,
        );

        const sent = mockSend.mock.calls[0][0];
        expect(sent.cc).toEqual(['info@jawab24.com']);
        expect(sent.bcc).toEqual(['rep@example.com']);
        expect(sent.attachments).toEqual([{ filename: 'invoice.pdf', content: 'QUFB' }]);
    });

    it('audits recipients and attachment NAMES, never the file bytes', async () => {
        mockLimit.mockResolvedValueOnce([{ id: USER_ID, email: 'm@x.com', name: 'متجر' }]);
        await adminUsersService.sendMerchantEmail(
            USER_ID,
            {
                subject: 'Invoice',
                body: 'Attached',
                cc: ['info@jawab24.com'],
                bcc: ['rep@example.com'],
                attachments: [{ filename: 'invoice.pdf', content: 'QUFBQUFB' }],
            },
            ADMIN_ID,
        );

        const audit = mockValues.mock.calls[0][0];
        expect(audit.newValue).toEqual({
            subject: 'Invoice',
            body: 'Attached',
            cc: ['info@jawab24.com'],
            bcc: ['rep@example.com'],
            attachments: ['invoice.pdf'],
        });
        // The base64 payload must not land in the audit table.
        expect(JSON.stringify(audit.newValue)).not.toContain('QUFBQUFB');
    });

    it('still resolves when the audit-log write fails (swallowed)', async () => {
        mockLimit.mockResolvedValueOnce([{ id: USER_ID, email: 'm@x.com', name: 'متجر' }]);
        mockValues.mockRejectedValueOnce(new Error('audit db down'));
        await expect(
            adminUsersService.sendMerchantEmail(USER_ID, { subject: 's', body: 'b' }, ADMIN_ID),
        ).resolves.toEqual({ emailSendId: 'es-1' });
    });
});
