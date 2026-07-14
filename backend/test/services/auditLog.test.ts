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

import { auditLog, logAutoReplyToggle } from '../../src/services/auditLog';
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

describe('logAutoReplyToggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockInsert.mockReturnValue({ values: mockValues });
        mockValues.mockResolvedValue(undefined);
    });

    it('derives actor="user" and records the full transition when a userId is given', async () => {
        logAutoReplyToggle({
            pageId: 'page-1',
            workspaceId: 'ws-1',
            userId: 'user-123',
            enabled: true,
            previous: false,
            reason: 'user',
        });
        // Fire-and-forget: let the delegated auditLog microtask settle.
        await Promise.resolve();

        expect(mockValues).toHaveBeenCalledWith({
            userId: 'user-123',
            workspaceId: 'ws-1',
            // The typed column — the queryable axis, immune to the metadata
            // double-encoding. Its absence is what would have made this feature
            // silently unqueryable.
            pageId: 'page-1',
            action: 'page.auto_reply_toggled',
            status: 'audit',
            metadata: {
                entityType: 'page',
                entityId: 'page-1',
                enabled: true,
                previous: false,
                reason: 'user',
                actor: 'user',
                channel: 'page',
            },
        });
    });

    it('derives actor="system" when no userId is given (auto-pause) and merges extra context', async () => {
        logAutoReplyToggle({
            pageId: 'page-9',
            workspaceId: 'ws-9',
            enabled: false,
            previous: true,
            reason: 'auto_pause',
            extra: { bucket: 'our_fault' },
        });
        await Promise.resolve();

        expect(mockValues).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: undefined,
                action: 'page.auto_reply_toggled',
                metadata: expect.objectContaining({
                    entityId: 'page-9',
                    enabled: false,
                    previous: true,
                    reason: 'auto_pause',
                    actor: 'system',
                    channel: 'page',
                    bucket: 'our_fault',
                }),
            }),
        );
    });

    it('defaults previous to null and channel to "page"', async () => {
        logAutoReplyToggle({ pageId: 'page-2', enabled: true, reason: 'fb_sync', userId: 'u-1' });
        await Promise.resolve();

        expect(mockValues).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({ previous: null, channel: 'page' }),
            }),
        );
    });
});
