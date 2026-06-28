import { describe, it, expect, vi } from 'vitest';

// Mock auth/workspace middleware
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn((_req: any, _reply: any, done: any) => done?.()),
}));

vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: vi.fn((_req: any, _reply: any, done: any) => done?.()),
    requireRole: vi.fn(() => vi.fn((_req: any, _reply: any, done: any) => done?.())),
}));

// Mock all salla controller functions
vi.mock('../../src/controllers/salla', () => ({
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
    listPendingHandler: vi.fn(),
    claimStoreHandler: vi.fn(),
}));

import sallaRoutes from '../../src/routes/salla';

describe('Salla Routes', () => {
    it('should register all required routes', async () => {
        const registeredRoutes: string[] = [];

        const mockFastify: any = {
            get: vi.fn((path: string) => registeredRoutes.push(`GET ${path}`)),
            post: vi.fn((path: string) => registeredRoutes.push(`POST ${path}`)),
            delete: vi.fn((path: string) => registeredRoutes.push(`DELETE ${path}`)),
            patch: vi.fn((path: string) => registeredRoutes.push(`PATCH ${path}`)),
            // sallaRoutes nests the shared route set via fastify.register — run it against
            // the same recorder so the shared routes are captured too.
            register: vi.fn((plugin: (f: unknown) => unknown) => plugin(mockFastify)),
        };

        await sallaRoutes(mockFastify);

        // Shared OAuth + CRUD set
        expect(registeredRoutes).toContain('GET /auth');
        expect(registeredRoutes).toContain('GET /auth/callback');
        expect(registeredRoutes).toContain('POST /webhooks');
        expect(registeredRoutes).toContain('GET /store');
        expect(registeredRoutes).toContain('GET /store/products');
        expect(registeredRoutes).toContain('POST /store/connect');
        expect(registeredRoutes).toContain('DELETE /store');
        expect(registeredRoutes).toContain('POST /store/sync');
        expect(registeredRoutes).toContain('PATCH /store/link-page');
        expect(registeredRoutes).toContain('PATCH /store/unlink-page');
        // Salla-only Easy Mode claim routes
        expect(registeredRoutes).toContain('GET /store/pending');
        expect(registeredRoutes).toContain('POST /store/claim');
    });
});
