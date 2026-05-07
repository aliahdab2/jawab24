import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EcommerceIntegration, StoreForWebhooks } from './registry';
import type { Logger } from '../types';
import type { WebhookRegistrationResult } from '../services/ecommerce';
import { config } from '../config';
import * as Sentry from '@sentry/node';

// Mirrors ZID_WEBHOOK_EVENTS in services/zid.ts. Tests assert these stay in sync.
const ZID_WEBHOOK_TOPICS = [
    'product.created',
    'product.updated',
    'product.deleted',
    'app.uninstalled',
    'order.created',
    'order.updated',
    'order.shipped',
    'order.delivered',
] as const;

/**
 * Zid e-commerce integration adapter.
 *
 * Zid is a leading Arab e-commerce platform (zid.sa).
 * Delegates to services/zid.ts, services/ecommerce.ts, routes/zid.ts,
 * and workers/ecommerceSyncWorker.ts — no business logic lives here.
 *
 * API notes:
 * - Auth header: X-MANAGER-TOKEN (NOT Authorization: Bearer)
 * - Token expiry: ~1 year
 * - Webhooks registered via API call after OAuth claim
 */
export class ZidIntegration implements EcommerceIntegration {
    readonly name = 'zid';
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;
    private tokenRefreshInterval: ReturnType<typeof setInterval> | null = null;

    isEnabled(): boolean {
        return !!config.zid?.clientId;
    }

    async registerRoutes(fastify: FastifyInstance): Promise<void> {
        const zidRoutes = (await import('../routes/zid')).default;
        await fastify.register(zidRoutes, { prefix: '/zid' });
    }

    async enrichKnowledgeBase(
        currentKB: string | undefined,
        page: Record<string, unknown>,
    ): Promise<string | null> {
        const storeId = page.ecommerceStoreId;
        if (!storeId || typeof storeId !== 'string') return null;

        const { getStoreById } = await import('../services/ecommerce');
        const store = await getStoreById(storeId);
        if (!store || store.platform !== 'zid') return null;

        const { getEnrichedKnowledgeBase } = await import('../services/ecommerce');
        return Sentry.startSpan(
            { name: 'zid.kb.enrich', op: 'db.query' },
            () => getEnrichedKnowledgeBase(currentKB, storeId),
        );
    }

    async claimPendingInstall(
        request: FastifyRequest,
        reply: FastifyReply,
        userId: string,
    ): Promise<Record<string, unknown> | null> {
        if (!request.cookies) return null;
        const cookie = request.cookies.pendingZidId;
        if (!cookie) return null;
        if (!request.unsignCookie) return null;

        const result = request.unsignCookie(cookie);
        if (!result.valid || !result.value) return null;

        try {
            const { claimPendingInstall, saveWebhookStatus } = await import('../services/ecommerce');
            const { registerWebhooks } = await import('../services/zid');

            const store = await claimPendingInstall(
                result.value,
                userId,
                'zid',
                async (_storeDomain: string, accessToken: string) => registerWebhooks(accessToken),
                saveWebhookStatus,
            );
            if (store) {
                reply.clearCookie('pendingZidId', { path: '/' });
                return { zidOnboarding: true, ecommerceStoreId: store.id };
            }
        } catch (err) {
            request.log.error({ err }, 'Failed to claim pending Zid install');
        }
        return null;
    }

    async onStartup(logger: Logger): Promise<void> {
        if (!this.isEnabled()) return;

        // Start the shared sync worker (idempotent — safe if Shopify/Salla already started it)
        const { startEcommerceSyncWorker, setSyncWorkerLogger } = await import('../workers/ecommerceSyncWorker');
        setSyncWorkerLogger(logger);
        startEcommerceSyncWorker();

        // Cleanup expired pending installs every hour
        const { cleanupExpiredInstalls } = await import('../services/ecommerce');
        this.cleanupInterval = setInterval(async () => {
            try {
                const cleaned = await cleanupExpiredInstalls('zid');
                if (cleaned > 0) logger.info(`Cleaned ${cleaned} expired Zid pending installs`);
            } catch (err) {
                logger.error('Zid cleanup failed', { err });
            }
        }, 60 * 60 * 1000);

        // Refresh expiring tokens every 6 hours (Zid tokens last ~1 year, but check proactively)
        const { refreshExpiringTokens } = await import('../services/zid');
        this.tokenRefreshInterval = setInterval(async () => {
            try {
                const refreshed = await refreshExpiringTokens();
                if (refreshed > 0) logger.info(`Refreshed ${refreshed} Zid tokens`);
            } catch (err) {
                logger.error('Zid token refresh failed', { err });
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
        return ZID_WEBHOOK_TOPICS;
    }

    async registerWebhooks(store: StoreForWebhooks): Promise<WebhookRegistrationResult> {
        const { decrypt } = await import('../services/ecommerceCrypto');
        const { registerWebhooks } = await import('../services/zid');
        const accessToken = decrypt(store.accessToken, store.accessTokenIv);
        return registerWebhooks(accessToken);
    }
}
