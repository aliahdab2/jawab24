import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EcommerceIntegration, StoreForWebhooks } from './registry';
import type { Logger } from '../types';
import type { WebhookRegistrationResult } from '../services/ecommerce';
import { config } from '../config';
import * as Sentry from '@sentry/node';

const SHOPIFY_WEBHOOK_TOPICS = [
    'app/uninstalled',
    'products/create',
    'products/update',
    'products/delete',
    'orders/create',
    'orders/fulfilled',
    'orders/cancelled',
    'fulfillments/update',
] as const;

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
        const storeId = page.ecommerceStoreId;
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

                // Billing trigger #2 (D-C): the merchant may have picked an App
                // Pricing plan before ever logging in here, in which case the
                // billing return endpoint fired against a pending install with
                // no subject user. Best-effort — the 6h reconciler is the
                // safety net, and a claim must never fail on a billing hiccup.
                const { syncShopifyBilling } = await import('../services/shopifyBilling');
                syncShopifyBilling(store.storeDomain, request.log).catch(err => {
                    request.log.warn(
                        { err, shopDomain: store.storeDomain },
                        'Post-claim Shopify billing sync failed — reconciler will retry'
                    );
                });

                return { shopifyOnboarding: true, ecommerceStoreId: store.id };
            }
        } catch (err) {
            request.log.error({ err }, 'Failed to claim pending Shopify install');
        }
        return null;
    }

    async onStartup(logger: Logger): Promise<void> {
        if (!this.isEnabled()) return;

        const { startEcommerceSyncWorker, setSyncWorkerLogger } = await import('../workers/ecommerceSyncWorker');
        setSyncWorkerLogger(logger);
        startEcommerceSyncWorker();

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
        const { stopEcommerceSyncWorker } = await import('../workers/ecommerceSyncWorker');
        await stopEcommerceSyncWorker();
    }

    getWebhookTopics(): readonly string[] {
        return SHOPIFY_WEBHOOK_TOPICS;
    }

    async registerWebhooks(store: StoreForWebhooks): Promise<WebhookRegistrationResult> {
        const { decrypt } = await import('../services/ecommerceCrypto');
        const { registerWebhooks } = await import('../services/shopify');
        const accessToken = decrypt(store.accessToken, store.accessTokenIv);
        return registerWebhooks(store.storeDomain, accessToken);
    }
}
