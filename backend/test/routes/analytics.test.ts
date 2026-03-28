import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import analyticsRoutes from '../../src/routes/analytics';

vi.mock('../../src/controllers/analytics', () => ({
    analyticsController: {
        getAiUsage: vi.fn((_req: unknown, reply: { send: (data: unknown) => unknown }) => reply.send({ ok: true })),
        getOverview: vi.fn((_req: unknown, reply: { send: (data: unknown) => unknown }) => reply.send({ ok: true })),
    },
}));

vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn((_req: unknown, _reply: unknown, done?: () => void) => done?.()),
}));

vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: vi.fn((_req: unknown, _reply: unknown, done?: () => void) => done?.()),
    requireRole: () => async () => {},
}));

vi.mock('../../src/lib/metrics', () => ({
    externalApiDuration: {
        get: vi.fn().mockResolvedValue({ values: [] }),
    },
}));

vi.mock('../../src/utils/healthChecks', () => ({
    probeDatabase: vi.fn().mockResolvedValue({ status: 'healthy', latencyMs: 5 }),
    probeRedis: vi.fn().mockResolvedValue({ status: 'healthy', latencyMs: 3 }),
    probeAiWorkerCircuit: vi.fn().mockResolvedValue('closed'),
}));

// Needed by analytics route imports
vi.mock('../../src/services/analytics', () => ({
    analyticsService: {
        getAiUsage: vi.fn(),
        getOverview: vi.fn(),
    },
}));

describe('Analytics Routes', () => {
    let app: ReturnType<typeof fastify>;

    beforeEach(async () => {
        app = fastify();
        app.register(analyticsRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    // ── GET /ai-usage ──────────────────────────────────────────────────────────

    describe('GET /ai-usage', () => {
        it('should return 200 and delegate to controller', async () => {
            const { analyticsController } = await import('../../src/controllers/analytics');
            vi.mocked(analyticsController.getAiUsage).mockImplementation(
                (_req: unknown, reply: { send: (data: unknown) => unknown }) => reply.send({ ok: true })
            );

            const response = await app.inject({
                method: 'GET',
                url: '/ai-usage',
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.ok).toBe(true);
        });
    });

    // ── GET /overview ─────────────────────────────────────────────────────────

    describe('GET /overview', () => {
        it('should return 200 and delegate to controller', async () => {
            const { analyticsController } = await import('../../src/controllers/analytics');
            vi.mocked(analyticsController.getOverview).mockImplementation(
                (_req: unknown, reply: { send: (data: unknown) => unknown }) => reply.send({ ok: true })
            );

            const response = await app.inject({
                method: 'GET',
                url: '/overview',
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.ok).toBe(true);
        });
    });

    // ── GET /system-health ────────────────────────────────────────────────────

    describe('GET /system-health', () => {
        it('should return 200 with correct shape when no histogram values', async () => {
            const { externalApiDuration } = await import('../../src/lib/metrics');
            vi.mocked(externalApiDuration.get).mockResolvedValue({ values: [] } as never);

            const response = await app.inject({
                method: 'GET',
                url: '/system-health',
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);

            // Shape: { services, process, externalApis }
            expect(body).toHaveProperty('services');
            expect(body).toHaveProperty('process');
            expect(body).toHaveProperty('externalApis');

            // services
            expect(body.services.database.status).toBe('healthy');
            expect(body.services.redis.status).toBe('healthy');
            expect(body.services.aiWorker.circuit).toBe('closed');

            // process
            expect(typeof body.process.memoryRssMb).toBe('number');
            expect(typeof body.process.uptimeSeconds).toBe('number');
            expect(body.process.uptimeSeconds).toBeGreaterThanOrEqual(0);

            // externalApis — empty when no histogram values
            expect(Array.isArray(body.externalApis)).toBe(true);
            expect(body.externalApis).toHaveLength(0);
        });

        it('should call all three health probes in parallel', async () => {
            const { probeDatabase, probeRedis, probeAiWorkerCircuit } = await import('../../src/utils/healthChecks');

            await app.inject({ method: 'GET', url: '/system-health' });

            expect(probeDatabase).toHaveBeenCalledTimes(1);
            expect(probeRedis).toHaveBeenCalledTimes(1);
            expect(probeAiWorkerCircuit).toHaveBeenCalledTimes(1);
        });

        it('should reflect probe latency in the response', async () => {
            const { probeDatabase, probeRedis } = await import('../../src/utils/healthChecks');
            vi.mocked(probeDatabase).mockResolvedValue({ status: 'healthy', latencyMs: 12 } as never);
            vi.mocked(probeRedis).mockResolvedValue({ status: 'healthy', latencyMs: 7 } as never);

            const response = await app.inject({ method: 'GET', url: '/system-health' });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.services.database.latencyMs).toBe(12);
            expect(body.services.redis.latencyMs).toBe(7);
        });

        it('should return externalApis with p50/p95/p99 when histogram data is present', async () => {
            const { externalApiDuration } = await import('../../src/lib/metrics');

            // Simulate a histogram for service=facebook, method=GET, status=2xx
            // Buckets: cumulative counts at latency boundaries (in seconds)
            // 10 requests, all completed within 0.1s (100ms)
            vi.mocked(externalApiDuration.get).mockResolvedValue({
                values: [
                    {
                        labels: { service: 'facebook', method: 'GET', status: '2xx' },
                        metricName: 'external_api_duration_seconds_count',
                        value: 10,
                    },
                    {
                        labels: { service: 'facebook', method: 'GET', status: '2xx', le: '0.05' },
                        metricName: 'external_api_duration_seconds_bucket',
                        value: 2,
                    },
                    {
                        labels: { service: 'facebook', method: 'GET', status: '2xx', le: '0.1' },
                        metricName: 'external_api_duration_seconds_bucket',
                        value: 10,
                    },
                    {
                        labels: { service: 'facebook', method: 'GET', status: '2xx', le: '0.5' },
                        metricName: 'external_api_duration_seconds_bucket',
                        value: 10,
                    },
                    {
                        labels: { service: 'facebook', method: 'GET', status: '2xx', le: '+Inf' },
                        metricName: 'external_api_duration_seconds_bucket',
                        value: 10,
                    },
                ],
            } as never);

            const response = await app.inject({ method: 'GET', url: '/system-health' });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);

            expect(Array.isArray(body.externalApis)).toBe(true);
            expect(body.externalApis).toHaveLength(1);

            const entry = body.externalApis[0];
            expect(entry.service).toBe('facebook');
            expect(entry.method).toBe('GET');
            expect(entry.status).toBe('2xx');
            expect(typeof entry.count).toBe('number');
            expect(entry.count).toBe(10);
            expect(typeof entry.p50Ms).toBe('number');
            expect(typeof entry.p95Ms).toBe('number');
            expect(typeof entry.p99Ms).toBe('number');
        });

        it('should skip groups with count=0 in externalApis', async () => {
            const { externalApiDuration } = await import('../../src/lib/metrics');

            vi.mocked(externalApiDuration.get).mockResolvedValue({
                values: [
                    {
                        labels: { service: 'salla', method: 'POST', status: '5xx' },
                        metricName: 'external_api_duration_seconds_count',
                        value: 0,
                    },
                ],
            } as never);

            const response = await app.inject({ method: 'GET', url: '/system-health' });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.externalApis).toHaveLength(0);
        });
    });
});
