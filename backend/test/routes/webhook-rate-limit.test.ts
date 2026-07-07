import { describe, it, expect, vi } from 'vitest';
import fastify from 'fastify';

// Only the route wiring is under test — stub the controller so importing it
// doesn't drag in db/redis/config.
vi.mock('../../src/controllers/webhook', () => ({
    webhookController: {
        verifyWebhook: vi.fn(),
        handleWebhook: vi.fn(),
        handleDataDeletion: vi.fn(),
    },
}));

import webhookRoutes from '../../src/routes/webhook';

describe('webhook routes rate-limit exemption', () => {
    it('opts every Meta-facing webhook route out of the global per-IP limiter', async () => {
        const app = fastify();
        const routeConfigs: Array<{ method: unknown; url: string; rateLimit: unknown }> = [];
        app.addHook('onRoute', (route) => {
            routeConfigs.push({
                method: route.method,
                url: route.url,
                rateLimit: (route.config as { rateLimit?: unknown } | undefined)?.rateLimit,
            });
        });

        await app.register(webhookRoutes);
        await app.ready();

        // Meta delivers all merchants' webhooks from a shared IP pool — if any
        // of these routes falls back under the global limiter, bursts get 429s
        // and Meta redelivers with backoff, delaying replies for everyone.
        const metaRoutes = routeConfigs.filter((r) => r.url.startsWith('/webhook'));
        expect(metaRoutes.length).toBeGreaterThanOrEqual(3);
        for (const route of metaRoutes) {
            expect(route.rateLimit, `${String(route.method)} ${route.url} must set config.rateLimit=false`).toBe(false);
        }

        await app.close();
    });
});
