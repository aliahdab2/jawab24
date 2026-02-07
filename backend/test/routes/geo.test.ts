import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';

// Module-level variable to control request.geo per test
let currentGeo: any = undefined;

// Mock the dynamic imports used inside the route handler
vi.mock('../../src/utils/sanctions', () => ({
    isSanctionedGeo: vi.fn(),
}));
vi.mock('../../src/middleware/geo', () => ({
    shouldBlockUnknownGeo: vi.fn(),
}));

import { isSanctionedGeo } from '../../src/utils/sanctions';
import { shouldBlockUnknownGeo } from '../../src/middleware/geo';
import geoRoutes from '../../src/routes/geo';

describe('Geo Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        currentGeo = undefined;
        vi.resetAllMocks();

        app = fastify();
        app.decorateRequest('geo', null);
        app.addHook('preHandler', async (request: any) => {
            request.geo = currentGeo;
        });
        app.register(geoRoutes, { prefix: '/geo' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    // -------------------------------------------------------
    // GET /geo/check
    // -------------------------------------------------------
    describe('GET /geo/check', () => {
        it('returns { sanctioned: false } when geo is not sanctioned', async () => {
            currentGeo = { country: 'US', source: 'cloudflare' };
            vi.mocked(isSanctionedGeo).mockReturnValue(false);
            vi.mocked(shouldBlockUnknownGeo).mockReturnValue(false);

            const response = await app.inject({
                method: 'GET',
                url: '/geo/check',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.sanctioned).toBe(false);
            expect(body.country).toBe('US');
        });

        it('returns { sanctioned: true } when geo is sanctioned', async () => {
            currentGeo = { country: 'SY', source: 'cloudflare' };
            vi.mocked(isSanctionedGeo).mockReturnValue(true);
            vi.mocked(shouldBlockUnknownGeo).mockReturnValue(false);

            const response = await app.inject({
                method: 'GET',
                url: '/geo/check',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.sanctioned).toBe(true);
            expect(body.country).toBe('SY');
        });

        it('returns { sanctioned: true } when geo is unknown and shouldBlockUnknownGeo returns true', async () => {
            currentGeo = undefined;
            vi.mocked(isSanctionedGeo).mockReturnValue(false);
            vi.mocked(shouldBlockUnknownGeo).mockReturnValue(true);

            const response = await app.inject({
                method: 'GET',
                url: '/geo/check',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.sanctioned).toBe(true);
            expect(body.country).toBeUndefined();
        });

        it('returns country code when available', async () => {
            currentGeo = { country: 'DE', region: 'DE-BY', source: 'nginx' };
            vi.mocked(isSanctionedGeo).mockReturnValue(false);
            vi.mocked(shouldBlockUnknownGeo).mockReturnValue(false);

            const response = await app.inject({
                method: 'GET',
                url: '/geo/check',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.sanctioned).toBe(false);
            expect(body.country).toBe('DE');
        });
    });
});
