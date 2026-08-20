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
    // Handlers are captured too, so a route whose behaviour lives in the factory itself
    // (rather than in a controller function) can be exercised — `GET /capabilities` is
    // the first such route.
    const handlers: Record<string, (...args: any[]) => any> = {};
    const record = (method: string) =>
        vi.fn((path: string, ...rest: any[]) => {
            registeredRoutes.push(`${method} ${path}`);
            const last = rest[rest.length - 1];
            if (typeof last === 'function') handlers[`${method} ${path}`] = last;
        });
    return {
        fastify: {
            get: record('GET'),
            post: record('POST'),
            delete: record('DELETE'),
            patch: record('PATCH'),
        },
        registeredRoutes,
        handlers,
    };
}

describe('createEcommerceRoutes', () => {
    it('should register all standard e-commerce routes', async () => {
        const controller = makeController();
        const routes = createEcommerceRoutes('salla', controller);
        const { fastify, registeredRoutes } = makeMockFastify();

        await routes(fastify as any);

        // Public OAuth routes
        expect(registeredRoutes).toContain('GET /auth');
        expect(registeredRoutes).toContain('GET /auth/callback');

        // Webhook route
        expect(registeredRoutes).toContain('POST /webhooks');

        // Read routes (all workspace members)
        expect(registeredRoutes).toContain('GET /capabilities');
        expect(registeredRoutes).toContain('GET /store');
        expect(registeredRoutes).toContain('GET /store/products');

        // Write routes (admin+)
        expect(registeredRoutes).toContain('POST /store/connect');
        expect(registeredRoutes).toContain('DELETE /store');
        expect(registeredRoutes).toContain('POST /store/sync');
        expect(registeredRoutes).toContain('POST /store/webhooks/reregister');
        expect(registeredRoutes).toContain('PATCH /store/link-page');
        expect(registeredRoutes).toContain('PATCH /store/unlink-page');
    });

    it('should register exactly 12 routes', async () => {
        const controller = makeController();
        const routes = createEcommerceRoutes('salla', controller);
        const { fastify, registeredRoutes } = makeMockFastify();

        await routes(fastify as any);

        expect(registeredRoutes).toHaveLength(12);
    });

    it('answers connectAvailable from the controller, defaulting to available', async () => {
        // The frontend renders its connect action from this, so the default matters:
        // a platform that never declares the predicate (Shopify, Zid) must keep working.
        const withoutPredicate = makeController();
        const withPredicate = { ...makeController(), isConnectAvailable: () => false };

        for (const [controller, expected] of [
            [withoutPredicate, true],
            [withPredicate, false],
        ] as const) {
            const { fastify, handlers } = makeMockFastify();
            await createEcommerceRoutes('salla', controller as any)(fastify as any);
            const send = vi.fn();
            await handlers['GET /capabilities']({} as any, { send } as any);
            expect(send).toHaveBeenCalledWith({ connectAvailable: expected });
        }
    });

    it('should wire controller functions to the correct routes', async () => {
        const controller = makeController();
        const routes = createEcommerceRoutes('salla', controller);
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
        const routes = createEcommerceRoutes('salla', controller);
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

        const sallaRoutes = createEcommerceRoutes('salla', sallaController);
        const zidRoutes = createEcommerceRoutes('zid', zidController);

        const { fastify: sallaFastify } = makeMockFastify();
        const { fastify: zidFastify } = makeMockFastify();

        await sallaRoutes(sallaFastify as any);
        await zidRoutes(zidFastify as any);

        // Salla and Zid use separate controller instances
        expect(sallaFastify.post.mock.calls[0][1]).toBe(sallaController.webhookHandler);
        expect(zidFastify.post.mock.calls[0][1]).toBe(zidController.webhookHandler);
    });
});
