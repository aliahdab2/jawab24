import { describe, it, expect, vi } from 'vitest';

// Mock auth/workspace middleware
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn((_req: any, _reply: any, done: any) => done?.()),
}));

vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: vi.fn((_req: any, _reply: any, done: any) => done?.()),
    requireRole: vi.fn(() => vi.fn((_req: any, _reply: any, done: any) => done?.())),
}));

// Mock all zid controller functions
vi.mock('../../src/controllers/zid', () => ({
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
}));

import zidRoutes from '../../src/routes/zid';

describe('Zid Routes', () => {
    it('should register all required routes', async () => {
        const registeredRoutes: string[] = [];

        const mockFastify = {
            get: vi.fn((path: string) => registeredRoutes.push(`GET ${path}`)),
            post: vi.fn((path: string) => registeredRoutes.push(`POST ${path}`)),
            delete: vi.fn((path: string) => registeredRoutes.push(`DELETE ${path}`)),
            patch: vi.fn((path: string) => registeredRoutes.push(`PATCH ${path}`)),
        };

        await zidRoutes(mockFastify as any);

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
    });
});
