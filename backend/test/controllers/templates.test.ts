import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies before imports
vi.mock('../../src/services/templates', () => ({
    templatesService: {
        createTemplate: vi.fn(),
        getTemplates: vi.fn(),
        getTemplate: vi.fn(),
        updateTemplate: vi.fn(),
        deleteTemplate: vi.fn(),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canAddTemplate: vi.fn(),
    },
}));

// Import controller AFTER mocks
import { templatesController } from '../../src/controllers/templates';
import { templatesService } from '../../src/services/templates';
import { subscriptionsService } from '../../src/services/subscriptions';

describe('TemplatesController', () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            code: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            query: {},
            params: {},
            body: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        } as any;
    });

    // ─── create ──────────────────────────────────────────

    describe('create()', () => {
        it('should return 201 with created template on success', async () => {
            const templateData = { name: 'Greeting', message: 'Hello!', active: true };
            const createdTemplate = { id: 'tpl-1', ...templateData, userId: 'user-123' };

            vi.mocked(subscriptionsService.canAddTemplate).mockResolvedValue({ allowed: true, limit: 20, used: 3 });
            vi.mocked(templatesService.createTemplate).mockResolvedValue(createdTemplate as any);

            (mockRequest as any).body = templateData;
            await templatesController.create(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(201);
            expect(mockReply.send).toHaveBeenCalledWith(createdTemplate);
        });

        it('should return 403 when subscription template limit reached', async () => {
            vi.mocked(subscriptionsService.canAddTemplate).mockResolvedValue({
                allowed: false,
                reason: 'Template limit reached',
                limit: 5,
                used: 5,
            });

            await templatesController.create(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Template limit reached', limit: 5, used: 5 }),
            );
        });

        it('should return 500 when service throws during create', async () => {
            vi.mocked(subscriptionsService.canAddTemplate).mockResolvedValue({ allowed: true, limit: 20, used: 1 });
            vi.mocked(templatesService.createTemplate).mockRejectedValue(new Error('DB error'));

            await templatesController.create(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to create template' });
        });
    });

    // ─── getAll ──────────────────────────────────────────

    describe('getAll()', () => {
        it('should return all templates for the user', async () => {
            const templates = [{ id: 'tpl-1', name: 'Greeting' }, { id: 'tpl-2', name: 'Farewell' }];
            vi.mocked(templatesService.getTemplates).mockResolvedValue(templates as any);

            await templatesController.getAll(mockRequest as any, mockReply as any);

            expect(templatesService.getTemplates).toHaveBeenCalledWith('user-123');
            expect(mockReply.send).toHaveBeenCalledWith(templates);
        });
    });

    // ─── getOne ──────────────────────────────────────────

    describe('getOne()', () => {
        beforeEach(() => {
            (mockRequest as any).params = { id: 'tpl-uuid-1' };
        });

        it('should return a single template on success', async () => {
            const template = { id: 'tpl-uuid-1', name: 'Greeting', message: 'Hello!' };
            vi.mocked(templatesService.getTemplate).mockResolvedValue(template as any);

            await templatesController.getOne(mockRequest as any, mockReply as any);

            expect(templatesService.getTemplate).toHaveBeenCalledWith('user-123', 'tpl-uuid-1');
            expect(mockReply.send).toHaveBeenCalledWith(template);
        });

        it('should return 404 when template not found', async () => {
            vi.mocked(templatesService.getTemplate).mockResolvedValue(null as any);

            await templatesController.getOne(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Template not found' });
        });
    });

    // ─── update ──────────────────────────────────────────

    describe('update()', () => {
        beforeEach(() => {
            (mockRequest as any).params = { id: 'tpl-uuid-1' };
            (mockRequest as any).body = { name: 'Updated Greeting' };
        });

        it('should return updated template on success', async () => {
            const updatedTemplate = { id: 'tpl-uuid-1', name: 'Updated Greeting' };
            vi.mocked(templatesService.updateTemplate).mockResolvedValue(updatedTemplate as any);

            await templatesController.update(mockRequest as any, mockReply as any);

            expect(templatesService.updateTemplate).toHaveBeenCalledWith('user-123', 'tpl-uuid-1', { name: 'Updated Greeting' });
            expect(mockReply.send).toHaveBeenCalledWith(updatedTemplate);
        });

        it('should return 404 when template to update not found', async () => {
            vi.mocked(templatesService.updateTemplate).mockResolvedValue(null as any);

            await templatesController.update(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Template not found' });
        });
    });

    // ─── delete ──────────────────────────────────────────

    describe('delete()', () => {
        beforeEach(() => {
            (mockRequest as any).params = { id: 'tpl-uuid-1' };
        });

        it('should return 204 on successful deletion', async () => {
            vi.mocked(templatesService.deleteTemplate).mockResolvedValue(undefined as any);

            await templatesController.delete(mockRequest as any, mockReply as any);

            expect(templatesService.deleteTemplate).toHaveBeenCalledWith('user-123', 'tpl-uuid-1');
            expect(mockReply.status).toHaveBeenCalledWith(204);
        });

        it('should return 500 when delete throws', async () => {
            vi.mocked(templatesService.deleteTemplate).mockRejectedValue(new Error('DB error'));

            await templatesController.delete(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to delete template' });
        });
    });
});
