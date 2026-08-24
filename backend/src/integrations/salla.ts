import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EcommerceIntegration, StoreForWebhooks } from './registry';
import type { Logger } from '../types';
import type { WebhookRegistrationResult } from '../services/ecommerce';
import { config } from '../config';
import * as Sentry from '@sentry/node';

// Mirrors SALLA_WEBHOOK_EVENTS in services/salla.ts (API-managed events first,
// then the portal-managed order events — see SALLA_PORTAL_WEBHOOK_EVENTS).
// Kept here so the adapter can answer getWebhookTopics() synchronously without
// importing the full service module. Tests assert these stay in sync.
const SALLA_WEBHOOK_TOPICS = [
    'product.created',
    'product.deleted',
    'product.price.updated',
    'product.status.updated',
    'product.quantity.low',
    'app.uninstalled',
    'abandoned.cart',
    'order.created',
    'order.updated',
    'order.status.updated',
    'order.shipment.created',
] as const;

/**
 * Salla e-commerce integration adapter.
 *
 * Delegates to services/salla.ts, services/ecommerce.ts, routes/salla.ts,
 * and workers/ecommerceSyncWorker.ts — no business logic lives here.
 */
export class SallaIntegration implements EcommerceIntegration {
    readonly name = 'salla';
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;
    private tokenRefreshInterval: ReturnType<typeof setInterval> | null = null;

    isEnabled(): boolean {
        return !!config.salla?.clientId;
    }

    async registerRoutes(fastify: FastifyInstance): Promise<void> {
        const sallaRoutes = (await import('../routes/salla')).default;
        await fastify.register(sallaRoutes, { prefix: '/salla' });
    }

    async enrichKnowledgeBase(
        currentKB: string | undefined,
        page: Record<string, unknown>,
    ): Promise<string | null> {
        const storeId = page.ecommerceStoreId;
        if (!storeId || typeof storeId !== 'string') return null;

        // Check that the store is actually a Salla store
        const { getStoreById } = await import('../services/ecommerce');
        const store = await getStoreById(storeId);
        if (!store || store.platform !== 'salla') return null;

        const { getEnrichedKnowledgeBase } = await import('../services/ecommerce');
        return Sentry.startSpan(
            { name: 'salla.kb.enrich', op: 'db.query' },
            () => getEnrichedKnowledgeBase(currentKB, storeId),
        );
    }

    async claimPendingInstall(
        request: FastifyRequest,
        reply: FastifyReply,
        userId: string,
    ): Promise<Record<string, unknown> | null> {
        if (!request.cookies) return null;
        const cookie = request.cookies.pendingSallaId;
        if (!cookie) return null;
        if (!request.unsignCookie) return null;

        const result = request.unsignCookie(cookie);
        if (!result.valid || !result.value) return null;

        try {
            const { claimPendingInstall, saveWebhookStatus } = await import('../services/ecommerce');
            const { registerWebhooks } = await import('../services/salla');

            const store = await claimPendingInstall(
                result.value,
                userId,
                'salla',
                async (_storeDomain: string, accessToken: string) => registerWebhooks(accessToken),
                saveWebhookStatus,
            );
            if (store) {
                reply.clearCookie('pendingSallaId', { path: '/' });
                return { sallaOnboarding: true, ecommerceStoreId: store.id };
            }
        } catch (err) {
            request.log.error({ err }, 'Failed to claim pending Salla install');
        }
        return null;
    }

    async onStartup(logger: Logger): Promise<void> {
        if (!this.isEnabled()) return;

        // Start the shared sync worker (idempotent — safe if Shopify already started it)
        const { startEcommerceSyncWorker, setSyncWorkerLogger } = await import('../workers/ecommerceSyncWorker');
        setSyncWorkerLogger(logger);
        startEcommerceSyncWorker();

        // Cleanup expired pending installs every hour
        const { cleanupExpiredInstalls } = await import('../services/ecommerce');
        this.cleanupInterval = setInterval(async () => {
            try {
                const cleaned = await cleanupExpiredInstalls('salla');
                if (cleaned > 0) logger.info(`Cleaned ${cleaned} expired Salla pending installs`);
            } catch (err) {
                logger.error('Salla cleanup failed', { err });
            }
        }, 60 * 60 * 1000);

        // Refresh expiring tokens every 6 hours
        const { refreshExpiringTokens } = await import('../services/salla');
        this.tokenRefreshInterval = setInterval(async () => {
            try {
                const refreshed = await refreshExpiringTokens();
                if (refreshed > 0) logger.info(`Refreshed ${refreshed} Salla tokens`);
            } catch (err) {
                logger.error('Salla token refresh failed', { err });
            }
        }, 6 * 60 * 60 * 1000);
    }

    async onShutdown(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        if (this.tokenRefreshInterval) {
            clearInterval(this.tokenRefreshInterval);
            this.tokenRefreshInterval = null;
        }
        // Worker shutdown is handled by the Shopify adapter (shared worker)
    }

    getWebhookTopics(): readonly string[] {
        return SALLA_WEBHOOK_TOPICS;
    }

    async registerWebhooks(store: StoreForWebhooks): Promise<WebhookRegistrationResult> {
        const { decrypt } = await import('../services/ecommerceCrypto');
        const { registerWebhooks } = await import('../services/salla');
        const accessToken = decrypt(store.accessToken, store.accessTokenIv);
        return registerWebhooks(accessToken);
    }
}
