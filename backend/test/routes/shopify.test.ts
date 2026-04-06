import { describe, it, expect, vi } from 'vitest';
import shopifyRoutes from '../../src/routes/shopify';

// Mock auth middleware
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn((_req: any, _reply: any, done: any) => done?.()),
}));

// Mock all controller functions
vi.mock('../../src/controllers/shopify', () => ({
    authRedirect: vi.fn(),
    authCallback: vi.fn(),
    webhookUninstall: vi.fn(),
    webhookProductsUpdate: vi.fn(),
    webhookOrders: vi.fn(),
    gdprCustomerDataRequest: vi.fn(),
    gdprCustomerRedact: vi.fn(),
    gdprShopRedact: vi.fn(),
    getStore: vi.fn(),
    connectStore: vi.fn(),
    disconnectStoreHandler: vi.fn(),
    syncStore: vi.fn(),
    getStoreProducts: vi.fn(),
    linkPage: vi.fn(),
    unlinkPage: vi.fn(),
}));

describe('Shopify Routes', () => {
    it('should register all required routes', async () => {
        const registeredRoutes: string[] = [];

        const mockFastify = {
            get: vi.fn((path: string) => registeredRoutes.push(`GET ${path}`)),
            post: vi.fn((path: string) => registeredRoutes.push(`POST ${path}`)),
            delete: vi.fn((path: string) => registeredRoutes.push(`DELETE ${path}`)),
            patch: vi.fn((path: string) => registeredRoutes.push(`PATCH ${path}`)),
        };

        await shopifyRoutes(mockFastify as any);

        // Public OAuth routes
        expect(registeredRoutes).toContain('GET /auth');
        expect(registeredRoutes).toContain('GET /auth/callback');

        // Webhook routes
        expect(registeredRoutes).toContain('POST /webhooks/uninstall');
        expect(registeredRoutes).toContain('POST /webhooks/products-update');

        // GDPR routes
        expect(registeredRoutes).toContain('POST /gdpr/customers/data_request');
        expect(registeredRoutes).toContain('POST /gdpr/customers/redact');
        expect(registeredRoutes).toContain('POST /gdpr/shop/redact');

        // Protected API routes
        expect(registeredRoutes).toContain('GET /store');
        expect(registeredRoutes).toContain('POST /store/connect');
        expect(registeredRoutes).toContain('DELETE /store');
        expect(registeredRoutes).toContain('POST /store/sync');
        expect(registeredRoutes).toContain('GET /store/products');
        expect(registeredRoutes).toContain('PATCH /store/link-page');
        expect(registeredRoutes).toContain('PATCH /store/unlink-page');
    });

    it('should protect API routes with authentication', async () => {
        const protectedRoutes: string[] = [];

        const mockFastify = {
            get: vi.fn((path: string, opts: any) => {
                if (opts?.preHandler) protectedRoutes.push(`GET ${path}`);
            }),
            post: vi.fn((path: string, opts: any) => {
                if (opts?.preHandler) protectedRoutes.push(`POST ${path}`);
            }),
            delete: vi.fn((path: string, opts: any) => {
                if (opts?.preHandler) protectedRoutes.push(`DELETE ${path}`);
            }),
            patch: vi.fn((path: string, opts: any) => {
                if (opts?.preHandler) protectedRoutes.push(`PATCH ${path}`);
            }),
        };

        await shopifyRoutes(mockFastify as any);

        // These should be protected
        expect(protectedRoutes).toContain('GET /store');
        expect(protectedRoutes).toContain('POST /store/connect');
        expect(protectedRoutes).toContain('DELETE /store');
        expect(protectedRoutes).toContain('POST /store/sync');
        expect(protectedRoutes).toContain('GET /store/products');
        expect(protectedRoutes).toContain('PATCH /store/link-page');
        expect(protectedRoutes).toContain('PATCH /store/unlink-page');

        // OAuth and webhook routes should NOT be in protected list
        expect(protectedRoutes).not.toContain('GET /auth');
        expect(protectedRoutes).not.toContain('GET /auth/callback');
        expect(protectedRoutes).not.toContain('POST /webhooks/uninstall');
    });
});
