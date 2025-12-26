import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import templatesRoutes from '../../src/routes/templates';
import { templatesService } from '../../src/services/templates';
import { authService } from '../../src/services/auth';

// Mock services
vi.mock('../../src/services/templates');
vi.mock('../../src/services/auth');
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canAddTemplate: vi.fn().mockResolvedValue({ allowed: true, limit: 10, used: 1, remaining: 9 }),
    }
}));
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { userId: 'test_user_id', facebookId: 'test_fb_id' };
    }
}));

describe('Templates Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(templatesRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    it('should create a new template', async () => {
        const newTemplateData = { 
            name: 'Welcome Template', 
            translations: { en: 'Welcome!', ar: 'أهلاً بك!' },
            keywords: ['hi', 'hello'] 
        };
        const createdTemplate = { 
            ...newTemplateData, 
            id: 'template_1', 
            userId: 'test_user_id', 
            active: true, 
            createdAt: new Date(), 
            updatedAt: new Date() 
        };

        vi.mocked(templatesService.createTemplate).mockResolvedValue(createdTemplate);

        const response = await app.inject({
            method: 'POST',
            url: '/templates',
            payload: newTemplateData
        });

        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.payload)).toEqual(JSON.parse(JSON.stringify(createdTemplate)));
        expect(templatesService.createTemplate).toHaveBeenCalledWith('test_user_id', newTemplateData);
    });

    it('should get all templates for user', async () => {
        const templatesList = [{ id: 'template_1', name: 'Welcome Template' }];
        vi.mocked(templatesService.getTemplates).mockResolvedValue(templatesList as any);

        const response = await app.inject({
            method: 'GET',
            url: '/templates'
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual(templatesList);
        expect(templatesService.getTemplates).toHaveBeenCalledWith('test_user_id');
    });

    it('should get a single template', async () => {
        const template = { id: 'template_1', name: 'Welcome Template' };
        vi.mocked(templatesService.getTemplate).mockResolvedValue(template as any);

        const response = await app.inject({
            method: 'GET',
            url: '/templates/template_1'
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual(template);
    });

    it('should return 404 if template not found', async () => {
        vi.mocked(templatesService.getTemplate).mockResolvedValue(null);

        const response = await app.inject({
            method: 'GET',
            url: '/templates/non_existent'
        });

        expect(response.statusCode).toBe(404);
    });

    it('should delete a template', async () => {
        vi.mocked(templatesService.deleteTemplate).mockResolvedValue(undefined);

        const response = await app.inject({
            method: 'DELETE',
            url: '/templates/template_1'
        });

        expect(response.statusCode).toBe(204);
        expect(templatesService.deleteTemplate).toHaveBeenCalledWith('test_user_id', 'template_1');
    });
});

