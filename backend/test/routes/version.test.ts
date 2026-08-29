import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';

// Mock child_process and fs before importing the route module
vi.mock('child_process', () => ({
    execSync: vi.fn().mockReturnValue('abc1234567890def\n'),
}));

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn().mockReturnValue(false),
        readFileSync: vi.fn(),
    },
}));

describe('Version Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        // Dynamically import after mocks are set up
        const versionRoutes = (await import('../../src/routes/version')).default;
        app = fastify();
        app.register(versionRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    // -------------------------------------------------------
    // GET /version
    // -------------------------------------------------------
    describe('GET /version', () => {
        it('returns 200 with version info structure', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/version',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body).toHaveProperty('version');
            expect(body).toHaveProperty('shortVersion');
            expect(body).toHaveProperty('deployedAt');
            expect(body).toHaveProperty('environment');
            expect(body).toHaveProperty('buildTime');
            expect(typeof body.version).toBe('string');
            expect(typeof body.shortVersion).toBe('string');
            expect(typeof body.deployedAt).toBe('string');
            expect(typeof body.environment).toBe('string');
            expect(typeof body.buildTime).toBe('string');
        });

        it('uses git commit from execSync when GIT_COMMIT env var is not set', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/version',
            });

            const body = response.json();
            // execSync mock returns 'abc1234567890def\n', trimmed to 'abc1234567890def'
            expect(body.version).toBe('abc1234567890def');
            expect(body.shortVersion).toBe('abc1234');
        });

        // Regression: this endpoint is the deploy-verification source. It was shipped
        // with `Cache-Control: public, max-age=86400, immutable`, which served the
        // pre-deploy commit for up to 24h after a deploy and made a single read report
        // "not live" when the deploy had in fact landed. It must never be cached.
        it('sets Cache-Control: no-store (never serve a stale deploy)', async () => {
            const response = await app.inject({ method: 'GET', url: '/version' });
            expect(response.headers['cache-control']).toBe('no-store');
        });
    });

    // -------------------------------------------------------
    // GET /version/short
    // -------------------------------------------------------
    describe('GET /version/short', () => {
        it('returns 200 with { v: string }', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/version/short',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body).toHaveProperty('v');
            expect(typeof body.v).toBe('string');
            expect(body.v).toBe('abc1234');
        });

        it('sets Cache-Control: no-store (never serve a stale deploy)', async () => {
            const response = await app.inject({ method: 'GET', url: '/version/short' });
            expect(response.headers['cache-control']).toBe('no-store');
        });
    });
});

describe('Version Routes with GIT_COMMIT env var', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        // Reset modules so getVersionInfo's cache is cleared
        vi.resetModules();

        // Re-apply mocks after resetModules
        vi.mock('child_process', () => ({
            execSync: vi.fn().mockReturnValue('abc1234567890def\n'),
        }));
        vi.mock('fs', () => ({
            default: {
                existsSync: vi.fn().mockReturnValue(false),
                readFileSync: vi.fn(),
            },
        }));

        // Set GIT_COMMIT env var before importing the module
        process.env.GIT_COMMIT = 'deadbeef12345678';

        const versionRoutes = (await import('../../src/routes/version')).default;
        app = fastify();
        app.register(versionRoutes);
        await app.ready();
    });

    afterAll(async () => {
        delete process.env.GIT_COMMIT;
        await app.close();
    });

    it('GET /version uses GIT_COMMIT env var when set', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/version',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.version).toBe('deadbeef12345678');
        expect(body.shortVersion).toBe('deadbee');
    });
});
