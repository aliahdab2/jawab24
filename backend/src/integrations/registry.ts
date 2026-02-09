import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from '../types';

/**
 * Contract for e-commerce platform integrations (Shopify, WooCommerce, Salla, etc.)
 *
 * Each integration implements these 4 hooks so core files (index.ts, auth.ts,
 * commentProcessor.ts, messageProcessor.ts) never import integration-specific code.
 */
export interface EcommerceIntegration {
    /** Unique name, e.g. 'shopify', 'woocommerce' */
    readonly name: string;

    /** Whether this integration is configured (has API keys, etc.) */
    isEnabled(): boolean;

    /** Register Fastify routes. Called during server startup. */
    registerRoutes(fastify: FastifyInstance): Promise<void>;

    /**
     * Enrich a page's knowledge base with product/catalog data.
     * Return enriched KB string if this integration is linked to the page,
     * or null if it doesn't apply.
     */
    enrichKnowledgeBase(
        currentKB: string | undefined,
        page: Record<string, unknown>,
    ): Promise<string | null>;

    /**
     * After a user authenticates, check for a pending install and claim it.
     * Returns fields to merge into the auth response, or null if nothing to claim.
     */
    claimPendingInstall(
        request: FastifyRequest,
        reply: FastifyReply,
        userId: string,
    ): Promise<Record<string, unknown> | null>;

    /** Start background workers, cleanup intervals, etc. */
    onStartup(logger: Logger): Promise<void>;

    /** Graceful shutdown: stop workers, clear intervals. */
    onShutdown(): Promise<void>;
}

class IntegrationRegistryImpl {
    private integrations: EcommerceIntegration[] = [];

    register(integration: EcommerceIntegration): void {
        if (this.integrations.find(i => i.name === integration.name)) {
            throw new Error(`Integration '${integration.name}' already registered`);
        }
        this.integrations.push(integration);
    }

    getAll(): readonly EcommerceIntegration[] {
        return this.integrations;
    }

    getEnabled(): EcommerceIntegration[] {
        return this.integrations.filter(i => i.isEnabled());
    }
}

export const integrationRegistry = new IntegrationRegistryImpl();
