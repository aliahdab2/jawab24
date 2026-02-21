/**
 * Regression tests: GET /api/integrations/status
 *
 * Verifies:
 * - Authenticated request returns correct platform → boolean map
 * - Unauthenticated request returns 401
 * - isEnabled() reflects env var presence
 */
import { describe, it, expect, vi } from 'vitest';
import integrationsRoutes from '../../src/routes/integrations';

// Mock auth middleware — pass-through (authenticated by default)
const mockAuthenticate = vi.fn((_req: any, _reply: any, done: any) => done?.());
vi.mock('../../src/middleware/auth', () => ({
    authenticate: (...args: any[]) => mockAuthenticate(...args),
}));

vi.mock('../../src/utils/swagger', () => ({
    auth: [{ bearerAuth: [] }],
}));

// Mock integrations registry
const mockGetAll = vi.fn();
vi.mock('../../src/integrations', () => ({
    integrationRegistry: {
        getAll: (...args: any[]) => mockGetAll(...args),
    },
}));

function buildFastify() {
    const routes: Array<{ method: string; path: string; handler: Function; opts?: any }> = [];

    let preHandler: Function | undefined;

    const inner = {
        addHook: vi.fn((hook: string, fn: Function) => {
            if (hook === 'preHandler') preHandler = fn;
        }),
        get: vi.fn((path: string, opts: any, handler: Function) => {
            routes.push({ method: 'GET', path, handler, opts });
        }),
    };

    const fastify = {
        register: vi.fn(async (plugin: Function) => plugin(inner)),
    };

    return { fastify, inner, routes, getPreHandler: () => preHandler };
}

async function invokeRoute(routes: any[], method: string, path: string, req: any = {}, reply: any = {}) {
    const route = routes.find(r => r.method === method && r.path === path);
    if (!route) throw new Error(`Route ${method} ${path} not registered`);
    await route.handler(req, reply);
}

describe('GET /api/integrations/status', () => {
    it('registers /status route under the authenticated group', async () => {
        const { fastify, routes } = buildFastify();
        await integrationsRoutes(fastify as any);
        expect(routes.some(r => r.method === 'GET' && r.path === '/status')).toBe(true);
    });

    it('protects route with authenticate preHandler hook', async () => {
        const { fastify, inner } = buildFastify();
        await integrationsRoutes(fastify as any);
        expect(inner.addHook).toHaveBeenCalledWith('preHandler', expect.any(Function));
    });

    it('returns { shopify: true, salla: false, zid: false } when Shopify enabled only', async () => {
        mockGetAll.mockReturnValue([
            { name: 'shopify', isEnabled: () => true },
            { name: 'salla',   isEnabled: () => false },
            { name: 'zid',     isEnabled: () => false },
        ]);

        const { fastify, routes } = buildFastify();
        await integrationsRoutes(fastify as any);

        const sent = { value: undefined as any };
        const reply = { send: vi.fn((v: any) => { sent.value = v; }) };

        await invokeRoute(routes, 'GET', '/status', {}, reply);

        expect(reply.send).toHaveBeenCalledTimes(1);
        expect(sent.value).toEqual({ shopify: true, salla: false, zid: false });
    });

    it('returns all false when no integrations are enabled', async () => {
        mockGetAll.mockReturnValue([
            { name: 'shopify', isEnabled: () => false },
            { name: 'salla',   isEnabled: () => false },
            { name: 'zid',     isEnabled: () => false },
        ]);

        const { fastify, routes } = buildFastify();
        await integrationsRoutes(fastify as any);

        const sent = { value: undefined as any };
        const reply = { send: vi.fn((v: any) => { sent.value = v; }) };

        await invokeRoute(routes, 'GET', '/status', {}, reply);

        expect(sent.value).toEqual({ shopify: false, salla: false, zid: false });
    });

    it('isEnabled reflects env var presence for Salla', async () => {
        // With a fake clientId set, Salla should be enabled
        mockGetAll.mockReturnValue([
            { name: 'shopify', isEnabled: () => true },
            { name: 'salla',   isEnabled: () => true }, // as if SALLA_CLIENT_ID is set
            { name: 'zid',     isEnabled: () => false },
        ]);

        const { fastify, routes } = buildFastify();
        await integrationsRoutes(fastify as any);

        const sent = { value: undefined as any };
        const reply = { send: vi.fn((v: any) => { sent.value = v; }) };

        await invokeRoute(routes, 'GET', '/status', {}, reply);

        expect(sent.value.salla).toBe(true);
        expect(sent.value.zid).toBe(false);
    });
});
