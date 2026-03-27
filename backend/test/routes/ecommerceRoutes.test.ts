import { describe, it, expect, vi } from 'vitest';
import { createEcommerceRoutes } from '../../src/routes/ecommerceRoutes';

// Mock auth/workspace middleware
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn((_req: any, _reply: any, done: any) => done?.()),
}));

vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: vi.fn((_req: any, _reply: any, done: any) => done?.()),
    requireRole: vi.fn(() => vi.fn((_req: any, _reply: any, done: any) => done?.())),
}));

function makeController() {
    return {
        authRedirect: vi.fn(),
        authCallback: vi.fn(),
        webhookHandler: vi.fn(),
        getStore: vi.fn(),
        getStoreProducts: vi.fn(),
        connectStore: vi.fn(),
        disconnectStoreHandler: vi.fn(),
        syncStore: vi.fn(),
        linkPage: vi.fn(),
        unlinkPage: vi.fn(),
    };
}

function makeMockFastify() {
    const registeredRoutes: string[] = [];
    return {
        fastify: {
            get: vi.fn((path: string) => registeredRoutes.push(`GET ${path}`)),
            post: vi.fn((path: string) => registeredRoutes.push(`POST ${path}`)),
            delete: vi.fn((path: string) => registeredRoutes.push(`DELETE ${path}`)),
            patch: vi.fn((path: string) => registeredRoutes.push(`PATCH ${path}`)),
        },
        registeredRoutes,
    };
}

describe('createEcommerceRoutes', () => {
    it('should register all standard e-commerce routes', async () => {
        const controller = makeController();
        const routes = createEcommerceRoutes(controller);
        const { fastify, registeredRoutes } = makeMockFastify();

        await routes(fastify as any);

        // Public OAuth routes
        expect(registeredRoutes).toContain('GET /auth');
        expect(registeredRoutes).toContain('GET /auth/callback');

        // Webhook route
        expect(registeredRoutes).toContain('POST /webhooks');

        // Read routes (all workspace members)
        expect(registeredRoutes).toContain('GET /store');
        expect(registeredRoutes).toContain('GET /store/products');

        // Write routes (admin+)
        expect(registeredRoutes).toContain('POST /store/connect');
        expect(registeredRoutes).toContain('DELETE /store');
        expect(registeredRoutes).toContain('POST /store/sync');
        expect(registeredRoutes).toContain('PATCH /store/link-page');
        expect(registeredRoutes).toContain('PATCH /store/unlink-page');
    });

    it('should register exactly 10 routes', async () => {
        const controller = makeController();
        const routes = createEcommerceRoutes(controller);
        const { fastify, registeredRoutes } = makeMockFastify();

        await routes(fastify as any);

        expect(registeredRoutes).toHaveLength(10);
    });

    it('should wire controller functions to the correct routes', async () => {
        const controller = makeController();
        const routes = createEcommerceRoutes(controller);
        const mockFastify = {
            get: vi.fn(),
            post: vi.fn(),
            delete: vi.fn(),
            patch: vi.fn(),
        };

        await routes(mockFastify as any);

        // authRedirect → GET /auth
        const getAuthCall = mockFastify.get.mock.calls.find(c => c[0] === '/auth');
        expect(getAuthCall).toBeDefined();
        expect(getAuthCall![1]).toBe(controller.authRedirect);

        // authCallback → GET /auth/callback
        const getCallbackCall = mockFastify.get.mock.calls.find(c => c[0] === '/auth/callback');
        expect(getCallbackCall).toBeDefined();
        expect(getCallbackCall![1]).toBe(controller.authCallback);

        // webhookHandler → POST /webhooks
        const postWebhookCall = mockFastify.post.mock.calls.find(c => c[0] === '/webhooks');
        expect(postWebhookCall).toBeDefined();
        expect(postWebhookCall![1]).toBe(controller.webhookHandler);
    });

    it('should apply preHandler middleware to protected routes', async () => {
        const controller = makeController();
        const routes = createEcommerceRoutes(controller);
        const mockFastify = {
            get: vi.fn(),
            post: vi.fn(),
            delete: vi.fn(),
            patch: vi.fn(),
        };

        await routes(mockFastify as any);

        // GET /store should have preHandler
        const getStoreCall = mockFastify.get.mock.calls.find(c => c[0] === '/store');
        expect(getStoreCall).toBeDefined();
        const opts = getStoreCall![1];
        expect(opts).toHaveProperty('preHandler');
        expect(Array.isArray(opts.preHandler)).toBe(true);
        expect(opts.preHandler.length).toBeGreaterThan(0);

        // DELETE /store should have preHandler with role guard
        const deleteStoreCall = mockFastify.delete.mock.calls.find(c => c[0] === '/store');
        expect(deleteStoreCall).toBeDefined();
        const deleteOpts = deleteStoreCall![1];
        expect(deleteOpts.preHandler.length).toBeGreaterThanOrEqual(3);
    });

    it('should work for independent controller instances (Salla and Zid isolation)', async () => {
        const sallaController = makeController();
        const zidController = makeController();

        const sallaRoutes = createEcommerceRoutes(sallaController);
        const zidRoutes = createEcommerceRoutes(zidController);

        const { fastify: sallaFastify } = makeMockFastify();
        const { fastify: zidFastify } = makeMockFastify();

        await sallaRoutes(sallaFastify as any);
        await zidRoutes(zidFastify as any);

        // Salla and Zid use separate controller instances
        expect(sallaFastify.post.mock.calls[0][1]).toBe(sallaController.webhookHandler);
        expect(zidFastify.post.mock.calls[0][1]).toBe(zidController.webhookHandler);
    });
});
