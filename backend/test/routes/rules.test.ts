import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import rulesRoutes from '../../src/routes/rules';
import { rulesService } from '../../src/services/rules';
import { authService } from '../../src/services/auth';

// Mock services
vi.mock('../../src/services/rules');
vi.mock('../../src/services/auth');
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { userId: 'test_user_id', facebookId: 'test_fb_id' };
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
        const newRuleData = { name: 'Test Rule', keywords: ['hello'], templateId: 'temp_1' };
        const createdRule = { ...newRuleData, id: 'rule_1', userId: 'test_user_id', priority: 0, active: true, createdAt: new Date(), updatedAt: new Date() };

        vi.mocked(rulesService.createRule).mockResolvedValue(createdRule);

        const response = await app.inject({
            method: 'POST',
            url: '/rules',
            payload: newRuleData
        });

        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.payload)).toEqual(JSON.parse(JSON.stringify(createdRule)));
        expect(rulesService.createRule).toHaveBeenCalledWith('test_user_id', newRuleData);
    });

    it('should get all rules for user', async () => {
        const rulesList = [{ id: 'rule_1', name: 'Test Rule' }];
        vi.mocked(rulesService.getRules).mockResolvedValue(rulesList as any);

        const response = await app.inject({
            method: 'GET',
            url: '/rules'
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual(rulesList);
        expect(rulesService.getRules).toHaveBeenCalledWith('test_user_id');
    });

    it('should get a single rule', async () => {
        const rule = { id: 'rule_1', name: 'Test Rule' };
        vi.mocked(rulesService.getRule).mockResolvedValue(rule as any);

        const response = await app.inject({
            method: 'GET',
            url: '/rules/rule_1'
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual(rule);
    });

    it('should return 404 if rule not found', async () => {
        vi.mocked(rulesService.getRule).mockResolvedValue(null);

        const response = await app.inject({
            method: 'GET',
            url: '/rules/non_existent'
        });

        expect(response.statusCode).toBe(404);
    });

    it('should delete a rule', async () => {
        vi.mocked(rulesService.deleteRule).mockResolvedValue(undefined);

        const response = await app.inject({
            method: 'DELETE',
            url: '/rules/rule_1'
        });

        expect(response.statusCode).toBe(204);
        expect(rulesService.deleteRule).toHaveBeenCalledWith('test_user_id', 'rule_1');
    });
});

