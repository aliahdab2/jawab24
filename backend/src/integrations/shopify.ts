import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EcommerceIntegration } from './registry';
import type { Logger } from '../types';
import { config } from '../config';
import * as Sentry from '@sentry/node';

/**
 * Shopify e-commerce integration adapter.
 *
 * Delegates to existing services/shopify.ts, routes/shopify.ts, and
 * workers/shopifySyncWorker.ts — no business logic lives here.
 */
export class ShopifyIntegration implements EcommerceIntegration {
    readonly name = 'shopify';
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    isEnabled(): boolean {
        return !!config.shopify?.apiKey;
    }

    async registerRoutes(fastify: FastifyInstance): Promise<void> {
        const shopifyRoutes = (await import('../routes/shopify')).default;
        await fastify.register(shopifyRoutes, { prefix: '/shopify' });
    }

    async enrichKnowledgeBase(
        currentKB: string | undefined,
        page: Record<string, unknown>,
    ): Promise<string | null> {
        const storeId = page.shopifyStoreId;
        if (!storeId || typeof storeId !== 'string') return null;

        const { getEnrichedKnowledgeBase } = await import('../services/shopify');
        return Sentry.startSpan(
            { name: 'shopify.kb.enrich', op: 'db.query' },
            () => getEnrichedKnowledgeBase(currentKB, storeId),
        );
    }

    async claimPendingInstall(
        request: FastifyRequest,
        reply: FastifyReply,
        userId: string,
    ): Promise<Record<string, unknown> | null> {
        if (!request.cookies) return null;
        const cookie = request.cookies.pendingShopifyId;
        if (!cookie) return null;
        if (!request.unsignCookie) return null;

        const result = request.unsignCookie(cookie);
        if (!result.valid || !result.value) return null;

        try {
            const { claimPendingInstall } = await import('../services/shopify');
            const store = await claimPendingInstall(result.value, userId);
            if (store) {
                reply.clearCookie('pendingShopifyId', { path: '/' });
                return { shopifyOnboarding: true, shopifyStoreId: store.id };
            }
        } catch (err) {
            request.log.error({ err }, 'Failed to claim pending Shopify install');
        }
        return null;
    }

    async onStartup(logger: Logger): Promise<void> {
        if (!this.isEnabled()) return;

        const { startShopifySyncWorker, setSyncWorkerLogger } = await import('../workers/shopifySyncWorker');
        setSyncWorkerLogger(logger);
        startShopifySyncWorker();

        const { cleanupExpiredInstalls } = await import('../services/shopify');
        this.cleanupInterval = setInterval(async () => {
            try {
                const cleaned = await cleanupExpiredInstalls();
                if (cleaned > 0) logger.info(`Cleaned ${cleaned} expired Shopify pending installs`);
            } catch (err) {
                logger.error('Shopify cleanup failed', { err });
            }
        }, 60 * 60 * 1000);
    }

    async onShutdown(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        const { stopShopifySyncWorker } = await import('../workers/shopifySyncWorker');
        await stopShopifySyncWorker();
    }
}
