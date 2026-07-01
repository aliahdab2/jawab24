import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { analyticsController } from '../controllers/analytics';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';
import { externalApiDuration } from '../lib/metrics';
import { probeDatabase, probeRedis, probeAiWorkerCircuit } from '../utils/healthChecks';

/**
 * Compute per-service/method latency summary from the prom-client histogram.
 * Returns p50, p95, p99, and total count for each service+method+status combo.
 */
async function computeExternalApiSummary(): Promise<Array<{
    service: string;
    method: string;
    status: string;
    count: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
}>> {
    const metric = await externalApiDuration.get();
    if (!metric.values.length) return [];

    // Group histogram buckets by service+method+status
    const groups = new Map<string, { buckets: Array<{ le: number; count: number }>; count: number; service: string; method: string; status: string }>();

    for (const v of metric.values) {
        const { service, method, status, le } = v.labels as { service: string; method: string; status: string; le?: string };
        const key = `${service}:${method}:${status}`;

        if (!groups.has(key)) {
            groups.set(key, { buckets: [], count: 0, service, method, status });
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- key was just set above
        const group = groups.get(key)!;

        const metricName = v.metricName ?? '';
        if (metricName.endsWith('_count')) {
            group.count = v.value;
        } else if (metricName.endsWith('_bucket') && le !== undefined) {
            group.buckets.push({ le: le === '+Inf' ? Infinity : parseFloat(le), count: v.value });
        }
    }

    // Compute percentiles from histogram buckets
    const results: Array<{ service: string; method: string; status: string; count: number; p50Ms: number; p95Ms: number; p99Ms: number }> = [];

    for (const group of groups.values()) {
        if (group.count === 0) continue;
        const sorted = group.buckets.filter(b => b.le !== Infinity).sort((a, b) => a.le - b.le);

        const percentile = (p: number): number => {
            const target = group.count * p;
            for (const bucket of sorted) {
                if (bucket.count >= target) return Math.round(bucket.le * 1000); // seconds → ms
            }
            return sorted.length > 0 ? Math.round(sorted[sorted.length - 1].le * 1000) : 0;
        };

        results.push({
            service: group.service,
            method: group.method,
            status: group.status,
            count: group.count,
            p50Ms: percentile(0.5),
            p95Ms: percentile(0.95),
            p99Ms: percentile(0.99),
        });
    }

    return results.sort((a, b) => b.count - a.count);
}

export default async function analyticsRoutes(fastify: FastifyInstance) {
    // --- Member+: usage and overview ---
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);
        protectedRoutes.addHook('preHandler', resolveWorkspace);

        protectedRoutes.get('/ai-usage', {
            schema: {
                tags: ['Analytics'],
                summary: 'Get AI token usage and cost breakdown',
                security: auth,
                querystring: {
                    type: 'object',
                    properties: {
                        days: { type: 'number', default: 30, description: 'Lookback window in days (1-365)' },
                    },
                },
            },
        }, analyticsController.getAiUsage);

        protectedRoutes.get('/overview', {
            schema: {
                tags: ['Analytics'],
                summary: 'Get analytics overview',
                security: auth,
                querystring: {
                    type: 'object',
                    properties: {
                        days: { type: 'number', default: 30, description: 'Lookback window in days (1-365)' },
                        pageId: { type: 'string', description: 'Filter by page UUID' },
                    },
                },
            },
        }, analyticsController.getOverview);
    });

    // --- Admin+: internal infrastructure metrics ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        /**
         * Operational system health metrics (JSON, for admin dashboard)
         * GET /analytics/system-health
         *
         * Uses Node.js APIs directly (not prom-client JSON parsing) for reliability.
         * Shared health probes from utils/healthChecks.ts avoid duplication with /health.
         */
        adminRoutes.get('/system-health', {
            schema: {
                tags: ['Analytics'],
                summary: 'Get operational system health metrics',
                security: auth,
            },
        }, async (_request: FastifyRequest, reply: FastifyReply) => {
            // Service health probes (parallel, shared with /health)
            const [dbProbe, redisProbe, circuitState] = await Promise.all([
                probeDatabase(),
                probeRedis(),
                probeAiWorkerCircuit(),
            ]);

            // Process metrics — direct Node.js APIs, no prom-client parsing
            const mem = process.memoryUsage();

            // External API latency percentiles from prom-client histogram
            const apiLatencies = await computeExternalApiSummary();

            return reply.send({
                services: {
                    database: { status: dbProbe.status, latencyMs: dbProbe.latencyMs },
                    redis: { status: redisProbe.status, latencyMs: redisProbe.latencyMs },
                    aiWorker: { circuit: circuitState },
                },
                process: {
                    memoryRssMb: Math.round(mem.rss / 1024 / 1024),
                    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
                    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
                    uptimeSeconds: Math.floor(process.uptime()),
                },
                externalApis: apiLatencies,
            });
        });
    });
}
