import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInsert, mockValues } = vi.hoisted(() => {
    const mockValues = vi.fn().mockResolvedValue(undefined);
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    return { mockInsert, mockValues };
});

vi.mock('../../src/db', () => ({
    db: { insert: mockInsert },
}));

vi.mock('../../src/db/schema', () => ({
    logs: { id: 'id', userId: 'userId', action: 'action', status: 'status', metadata: 'metadata' },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

import { auditLog } from '../../src/services/auditLog';
import { captureError } from '../../src/utils/sentryHelpers';

describe('auditLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockInsert.mockReturnValue({ values: mockValues });
        mockValues.mockResolvedValue(undefined);
    });

    it('should insert an audit log entry into the logs table', async () => {
        await auditLog({
            userId: 'user-123',
            action: 'settings.updated',
            entityType: 'settings',
            metadata: { fields: ['autoReplyEnabled'] },
        });

        expect(mockInsert).toHaveBeenCalled();
        expect(mockValues).toHaveBeenCalledWith({
            userId: 'user-123',
            action: 'settings.updated',
            status: 'audit',
            metadata: {
                entityType: 'settings',
                entityId: undefined,
                fields: ['autoReplyEnabled'],
            },
        });
    });

    it('should include entityId in metadata when provided', async () => {
        await auditLog({
            userId: 'user-123',
            action: 'template.deleted',
            entityType: 'template',
            entityId: 'tmpl-456',
        });

        expect(mockValues).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({
                    entityType: 'template',
                    entityId: 'tmpl-456',
                }),
            }),
        );
    });

    it('should never throw on DB errors (fire-and-forget)', async () => {
        mockValues.mockRejectedValueOnce(new Error('connection refused'));

        await expect(
            auditLog({ userId: 'user-123', action: 'account.deleted', entityType: 'user' }),
        ).resolves.toBeUndefined();

        expect(captureError).toHaveBeenCalledWith(
            expect.any(Error),
            'Audit log write failed',
            expect.objectContaining({
                tags: { service: 'audit' },
                extra: { action: 'account.deleted', userId: 'user-123' },
            }),
        );
    });

    it('should handle insert throwing synchronously', async () => {
        mockInsert.mockImplementationOnce(() => {
            throw new Error('schema mismatch');
        });

        await expect(
            auditLog({ userId: 'user-123', action: 'rule.created' }),
        ).resolves.toBeUndefined();

        expect(captureError).toHaveBeenCalled();
    });
});
