import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import rulesRoutes from '../../src/routes/rules';
import { rulesService } from '../../src/services/rules';
import { authService } from '../../src/services/auth';

// Mock services
vi.mock('../../src/services/rules');
vi.mock('../../src/services/auth');
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canAddRule: vi.fn().mockResolvedValue({ allowed: true, limit: 10, used: 1, remaining: 9 }),
    }
}));
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { userId: 'test_user_id', facebookId: 'test_fb_id' };
    }
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'test_workspace_id';
        req.workspaceRole = 'owner';
    }
}));

describe('Rules Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        // We need to register the auth middleware mock before routes if it was global, 
        // but here it's imported in the route file.
        // Since we mocked the module, the route should use the mock.
        app.register(rulesRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    it('should create a new rule', async () => {
        // Include templateId as a valid UUID format
        const newRuleData = { name: 'Test Rule', keywords: ['hello'], templateId: '123e4567-e89b-12d3-a456-426614174000' };
        const createdRule = { ...newRuleData, id: 'rule_1', userId: 'test_user_id', priority: 0, active: true, createdAt: new Date(), updatedAt: new Date() };

        vi.mocked(rulesService.createRule).mockResolvedValue(createdRule);

        const response = await app.inject({
            method: 'POST',
            url: '/rules',
            payload: newRuleData
        });

        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.payload)).toEqual(JSON.parse(JSON.stringify(createdRule)));
    });

    it('should get all rules for user', async () => {
        const rulesList = [{ id: 'rule_1', name: 'Test Rule' }];
        // Mock the paginated response
        vi.mocked(rulesService.getRules).mockResolvedValue({
            data: rulesList,
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
        } as any);

        const response = await app.inject({
            method: 'GET',
            url: '/rules'
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.data).toEqual(rulesList);
        expect(body.pagination).toBeDefined();
        expect(rulesService.getRules).toHaveBeenCalledWith('test_workspace_id', { page: 1, limit: 20 });
    });

    it('should get a single rule', async () => {
        const rule = { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Test Rule' };
        vi.mocked(rulesService.getRule).mockResolvedValue(rule as any);

        const response = await app.inject({
            method: 'GET',
            url: '/rules/123e4567-e89b-12d3-a456-426614174000'
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual(rule);
    });

    it('should return 404 if rule not found', async () => {
        vi.mocked(rulesService.getRule).mockResolvedValue(null);

        const response = await app.inject({
            method: 'GET',
            url: '/rules/123e4567-e89b-12d3-a456-426614174000'
        });

        expect(response.statusCode).toBe(404);
    });

    it('should delete a rule', async () => {
        vi.mocked(rulesService.deleteRule).mockResolvedValue(undefined);

        const response = await app.inject({
            method: 'DELETE',
            url: '/rules/123e4567-e89b-12d3-a456-426614174000'
        });

        expect(response.statusCode).toBe(204);
        expect(rulesService.deleteRule).toHaveBeenCalledWith('test_workspace_id', '123e4567-e89b-12d3-a456-426614174000');
    });

    it('should return 400 for invalid rule ID', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/rules/not-a-valid-uuid'
        });

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.payload).error).toBe('Invalid rule ID format');
    });

    it('should return 400 for invalid rule body', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/rules',
            payload: { name: '', keywords: [] } // Empty name and keywords should fail validation
        });

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.payload).error).toBe('Validation failed');
    });
});

