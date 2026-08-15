import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import partnerRoutes from '../../src/routes/partner';

/**
 * Partner Portal route — access-boundary tests.
 *
 * The portal is the only surface an external (non-admin) party can hit, so
 * the boundaries matter more than the payload: unauthenticated → 401,
 * authenticated non-partner → 403, partner → 200 with ONLY the overview
 * shape (no email, no costs).
 */

vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn(async (req: any) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            const err: any = new Error('Unauthorized');
            err.statusCode = 401;
            throw err;
        }
        req.user = { userId: 'partner-user-id' };
    }),
    AuthenticatedRequest: {},
}));

vi.mock('../../src/db', () => {
    const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 'partner-user-id', email: 'rep@example.com' }]),
    };
    return { db: { select: vi.fn(() => chain) } };
});

vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', email: 'email' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
}));

vi.mock('../../src/services/partnerPortal', () => ({
    partnerPortalService: {
        resolvePartnerForUser: vi.fn(),
        getOverview: vi.fn(),
    },
}));

import { partnerPortalService } from '../../src/services/partnerPortal';

describe('Partner Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = fastify();
        await app.register(partnerRoutes, { prefix: '/partner' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('GET /partner/overview returns 401 without authorization header', async () => {
        const response = await app.inject({ method: 'GET', url: '/partner/overview' });
        expect(response.statusCode).toBe(401);
    });

    it('GET /partner/overview returns 403 for an authenticated non-partner', async () => {
        vi.mocked(partnerPortalService.resolvePartnerForUser).mockResolvedValue(null);

        const response = await app.inject({
            method: 'GET',
            url: '/partner/overview',
            headers: { authorization: 'Bearer valid-token' },
        });

        expect(response.statusCode).toBe(403);
        expect(JSON.parse(response.payload).code).toBe('NOT_A_PARTNER');
        expect(partnerPortalService.getOverview).not.toHaveBeenCalled();
    });

    it('GET /partner/overview returns the overview for a partner', async () => {
        const partner = { id: 'p-1', name: 'Ahmad', commissionPct: 20 } as any;
        vi.mocked(partnerPortalService.resolvePartnerForUser).mockResolvedValue(partner);
        vi.mocked(partnerPortalService.getOverview).mockResolvedValue({
            partner: { name: 'Ahmad' },
            merchants: [{
                id: 'u-1', name: 'Merchant', phone: '+963944000000', pageNames: ['Page'],
                planName: null, status: 'trialing', trialEndsAt: null, currentPeriodEnd: null,
                createdAt: null, lastSeenAt: null, adminNote: null,
            }],
        });

        const response = await app.inject({
            method: 'GET',
            url: '/partner/overview',
            headers: { authorization: 'Bearer valid-token' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.success).toBe(true);
        expect(body.data.partner).toEqual({ name: 'Ahmad' });
        expect(body.data.merchants).toHaveLength(1);
        // Least-privilege: the merchant row must never carry an email field,
        // and the partner block must not expose the commission %.
        expect(body.data.merchants[0]).not.toHaveProperty('email');
        expect(body.data.partner).not.toHaveProperty('commissionPct');
    });
});
