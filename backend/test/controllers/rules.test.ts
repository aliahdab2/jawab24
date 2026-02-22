import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies before imports
vi.mock('../../src/services/rules', () => ({
    rulesService: {
        createRule: vi.fn(),
        getRules: vi.fn(),
        getRule: vi.fn(),
        updateRule: vi.fn(),
        deleteRule: vi.fn(),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canAddRule: vi.fn(),
    },
}));

vi.mock('../../src/utils/validation', () => ({
    CreateRuleSchema: { safeParse: vi.fn() },
    UpdateRuleSchema: { safeParse: vi.fn() },
    UUIDSchema: { safeParse: vi.fn() },
    PaginationSchema: { safeParse: vi.fn() },
    validateSchema: vi.fn(),
}));

// Import controller AFTER mocks
import { rulesController } from '../../src/controllers/rules';
import { rulesService } from '../../src/services/rules';
import { subscriptionsService } from '../../src/services/subscriptions';
import { UUIDSchema, PaginationSchema, validateSchema } from '../../src/utils/validation';

describe('RulesController', () => {
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
            workspaceId: 'test_workspace_id',
            workspaceRole: 'owner',
            query: {},
            params: {},
            body: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        } as any;
    });

    // ─── create ──────────────────────────────────────────

    describe('create()', () => {
        it('should return 201 with created rule on success', async () => {
            const ruleData = { name: 'Test Rule', keywords: ['hello'], templateId: 'tpl-1', priority: 0, active: true };
            const createdRule = { id: 'rule-1', ...ruleData, userId: 'user-123' };

            vi.mocked(validateSchema).mockReturnValue({ success: true, data: ruleData });
            vi.mocked(subscriptionsService.canAddRule).mockResolvedValue({ allowed: true, limit: 10, used: 1 });
            vi.mocked(rulesService.createRule).mockResolvedValue(createdRule as any);

            await rulesController.create(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(201);
            expect(mockReply.send).toHaveBeenCalledWith(createdRule);
        });

        it('should return 400 when validation fails', async () => {
            vi.mocked(validateSchema).mockReturnValue({
                success: false,
                errors: [{ field: 'name', message: 'Rule name is required' }],
            });

            await rulesController.create(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Validation failed' }),
            );
        });

        it('should return 403 when subscription rule limit reached', async () => {
            vi.mocked(validateSchema).mockReturnValue({ success: true, data: {} });
            vi.mocked(subscriptionsService.canAddRule).mockResolvedValue({
                allowed: false,
                reason: 'Rule limit reached',
                limit: 5,
                used: 5,
            });

            await rulesController.create(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Rule limit reached', limit: 5, used: 5 }),
            );
        });
    });

    // ─── getAll ──────────────────────────────────────────

    describe('getAll()', () => {
        it('should return paginated rules', async () => {
            const result = { data: [{ id: 'rule-1' }], total: 1, page: 1, limit: 20 };
            vi.mocked(PaginationSchema.safeParse).mockReturnValue({ success: true, data: { page: 1, limit: 20 } } as any);
            vi.mocked(rulesService.getRules).mockResolvedValue(result as any);

            await rulesController.getAll(mockRequest as any, mockReply as any);

            expect(rulesService.getRules).toHaveBeenCalledWith('test_workspace_id', { page: 1, limit: 20 });
            expect(mockReply.send).toHaveBeenCalledWith(result);
        });
    });

    // ─── getOne ──────────────────────────────────────────

    describe('getOne()', () => {
        beforeEach(() => {
            (mockRequest as any).params = { id: 'rule-uuid-1' };
        });

        it('should return a single rule on success', async () => {
            const rule = { id: 'rule-uuid-1', name: 'Test' };
            vi.mocked(UUIDSchema.safeParse).mockReturnValue({ success: true, data: 'rule-uuid-1' } as any);
            vi.mocked(rulesService.getRule).mockResolvedValue(rule as any);

            await rulesController.getOne(mockRequest as any, mockReply as any);

            expect(rulesService.getRule).toHaveBeenCalledWith('test_workspace_id', 'rule-uuid-1');
            expect(mockReply.send).toHaveBeenCalledWith(rule);
        });

        it('should return 404 when rule not found', async () => {
            vi.mocked(UUIDSchema.safeParse).mockReturnValue({ success: true, data: 'rule-uuid-1' } as any);
            vi.mocked(rulesService.getRule).mockResolvedValue(null as any);

            await rulesController.getOne(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Rule not found' });
        });

        it('should return 400 for invalid UUID', async () => {
            vi.mocked(UUIDSchema.safeParse).mockReturnValue({ success: false, error: {} } as any);

            await rulesController.getOne(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Invalid rule ID format' });
        });
    });

    // ─── update ──────────────────────────────────────────

    describe('update()', () => {
        beforeEach(() => {
            (mockRequest as any).params = { id: 'rule-uuid-1' };
            (mockRequest as any).body = { name: 'Updated Rule' };
        });

        it('should return updated rule on success', async () => {
            const updatedRule = { id: 'rule-uuid-1', name: 'Updated Rule' };
            vi.mocked(UUIDSchema.safeParse).mockReturnValue({ success: true, data: 'rule-uuid-1' } as any);
            vi.mocked(validateSchema).mockReturnValue({ success: true, data: { name: 'Updated Rule' } });
            vi.mocked(rulesService.updateRule).mockResolvedValue(updatedRule as any);

            await rulesController.update(mockRequest as any, mockReply as any);

            expect(mockReply.send).toHaveBeenCalledWith(updatedRule);
        });

        it('should return 404 when rule to update not found', async () => {
            vi.mocked(UUIDSchema.safeParse).mockReturnValue({ success: true, data: 'rule-uuid-1' } as any);
            vi.mocked(validateSchema).mockReturnValue({ success: true, data: { name: 'Updated Rule' } });
            vi.mocked(rulesService.updateRule).mockResolvedValue(null as any);

            await rulesController.update(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Rule not found' });
        });

        it('should return 400 when update body validation fails', async () => {
            vi.mocked(UUIDSchema.safeParse).mockReturnValue({ success: true, data: 'rule-uuid-1' } as any);
            vi.mocked(validateSchema).mockReturnValue({
                success: false,
                errors: [{ field: 'name', message: 'Too long' }],
            });

            await rulesController.update(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Validation failed' }),
            );
        });
    });

    // ─── delete ──────────────────────────────────────────

    describe('delete()', () => {
        beforeEach(() => {
            (mockRequest as any).params = { id: 'rule-uuid-1' };
        });

        it('should return 204 on successful deletion', async () => {
            vi.mocked(UUIDSchema.safeParse).mockReturnValue({ success: true, data: 'rule-uuid-1' } as any);
            vi.mocked(rulesService.deleteRule).mockResolvedValue(undefined as any);

            await rulesController.delete(mockRequest as any, mockReply as any);

            expect(rulesService.deleteRule).toHaveBeenCalledWith('test_workspace_id', 'rule-uuid-1');
            expect(mockReply.status).toHaveBeenCalledWith(204);
        });

        it('should return 400 for invalid UUID on delete', async () => {
            vi.mocked(UUIDSchema.safeParse).mockReturnValue({ success: false, error: {} } as any);

            await rulesController.delete(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Invalid rule ID format' });
        });
    });
});
