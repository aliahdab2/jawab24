import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — before importing the route module
// ---------------------------------------------------------------------------
vi.mock('../../src/controllers/workspace', () => ({
    workspaceController: {
        list: vi.fn(),
        create: vi.fn(),
        acceptInvite: vi.fn(),
        getOne: vi.fn(),
        getMembers: vi.fn(),
        getSettings: vi.fn(),
        update: vi.fn(),
        updateSettings: vi.fn(),
        removeMember: vi.fn(),
        createInvite: vi.fn(),
        listInvites: vi.fn(),
        revokeInvite: vi.fn(),
        updateMemberRole: vi.fn(),
        remove: vi.fn(),
    },
}));

vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn((_req: any, _reply: any, done: any) => done?.()),
}));

vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: vi.fn((_req: any, _reply: any, done: any) => done?.()),
    requireRole: vi.fn(() => vi.fn((_req: any, _reply: any, done: any) => done?.())),
}));

vi.mock('../../src/utils/swagger', () => ({
    auth: [{ bearerAuth: [] }],
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import workspaceRoutes from '../../src/routes/workspace';

// ---------------------------------------------------------------------------
// Helper — mock Fastify instance
//
// workspaceRoutes uses nested fastify.register() calls, so the mock `register`
// must call the plugin function with itself (the same mockFastify), which
// allows inner routes to be recorded on the shared instance.
// ---------------------------------------------------------------------------
function buildMockFastify() {
    const registeredRoutes: string[] = [];
    const hooks: Array<{ name: string; fn: Function }> = [];

    const mockFastify: any = {
        get: vi.fn((path: string) => registeredRoutes.push(`GET ${path}`)),
        post: vi.fn((path: string) => registeredRoutes.push(`POST ${path}`)),
        put: vi.fn((path: string) => registeredRoutes.push(`PUT ${path}`)),
        patch: vi.fn((path: string) => registeredRoutes.push(`PATCH ${path}`)),
        delete: vi.fn((path: string) => registeredRoutes.push(`DELETE ${path}`)),
        addHook: vi.fn((name: string, fn: Function) => hooks.push({ name, fn })),
        // register must forward the plugin to itself so nested routes are captured
        register: vi.fn((fn: any) => fn(mockFastify)),
        _routes: registeredRoutes,
        _hooks: hooks,
    };

    return mockFastify;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Workspace Routes', () => {
    let mockFastify: ReturnType<typeof buildMockFastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockFastify = buildMockFastify();
        await workspaceRoutes(mockFastify);
    });

    describe('route registration', () => {
        it('registers GET /workspaces', () => {
            expect(mockFastify._routes).toContain('GET /workspaces');
        });

        it('registers POST /workspaces', () => {
            expect(mockFastify._routes).toContain('POST /workspaces');
        });

        it('registers POST /invites/accept', () => {
            expect(mockFastify._routes).toContain('POST /invites/accept');
        });

        it('registers GET /workspaces/current', () => {
            expect(mockFastify._routes).toContain('GET /workspaces/current');
        });

        it('registers GET /workspaces/current/members', () => {
            expect(mockFastify._routes).toContain('GET /workspaces/current/members');
        });

        it('registers GET /workspaces/current/settings', () => {
            expect(mockFastify._routes).toContain('GET /workspaces/current/settings');
        });

        it('registers PUT /workspaces/current', () => {
            expect(mockFastify._routes).toContain('PUT /workspaces/current');
        });

        it('registers PUT /workspaces/current/settings', () => {
            expect(mockFastify._routes).toContain('PUT /workspaces/current/settings');
        });

        it('registers DELETE /workspaces/current/members/:userId', () => {
            expect(mockFastify._routes).toContain('DELETE /workspaces/current/members/:userId');
        });

        it('registers POST /workspaces/current/invites', () => {
            expect(mockFastify._routes).toContain('POST /workspaces/current/invites');
        });

        it('registers GET /workspaces/current/invites', () => {
            expect(mockFastify._routes).toContain('GET /workspaces/current/invites');
        });

        it('registers DELETE /workspaces/current/invites/:inviteId', () => {
            expect(mockFastify._routes).toContain('DELETE /workspaces/current/invites/:inviteId');
        });

        it('registers PATCH /workspaces/current/members/:userId', () => {
            expect(mockFastify._routes).toContain('PATCH /workspaces/current/members/:userId');
        });

        it('registers DELETE /workspaces/current', () => {
            expect(mockFastify._routes).toContain('DELETE /workspaces/current');
        });

        it('registers all 15 expected routes in total', () => {
            const expected = [
                'GET /workspaces',
                'POST /workspaces',
                'POST /invites/accept',
                'PATCH /me/last-workspace',
                'GET /workspaces/current',
                'GET /workspaces/current/members',
                'GET /workspaces/current/settings',
                'PUT /workspaces/current',
                'PUT /workspaces/current/settings',
                'DELETE /workspaces/current/members/:userId',
                'POST /workspaces/current/invites',
                'GET /workspaces/current/invites',
                'DELETE /workspaces/current/invites/:inviteId',
                'PATCH /workspaces/current/members/:userId',
                'DELETE /workspaces/current',
            ];
            for (const route of expected) {
                expect(mockFastify._routes).toContain(route);
            }
            expect(mockFastify._routes).toHaveLength(expected.length);
        });
    });
});
