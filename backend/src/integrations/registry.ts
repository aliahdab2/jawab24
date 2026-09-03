import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from '../types';
import type { WebhookRegistrationResult } from '../services/ecommerce';

/**
 * Subset of the ecommerceStores row needed for webhook registration.
 *
 * `accessToken` and `accessTokenIv` are AES-256-GCM ciphertext + IV — call
 * `decrypt(accessToken, accessTokenIv)` from `services/ecommerceCrypto` to
 * obtain the plaintext token before sending API requests.
 */
export interface StoreForWebhooks {
    id: string;
    storeDomain: string;
    /** Encrypted access token (ciphertext). Decrypt with `accessTokenIv`. */
    accessToken: string;
    /** AES-256-GCM IV paired with `accessToken`. */
    accessTokenIv: string;
    /** Zid only — encrypted `Authorization` Bearer token (dual-header auth). */
    authorizationToken?: string | null;
    /** AES-256-GCM IV paired with `authorizationToken`. */
    authorizationTokenIv?: string | null;
}

/**
 * Narrow a full `ecommerce_stores` row to the fields webhook registration needs.
 *
 * ⚠️ Always use this instead of hand-writing the object literal. Zid needs BOTH
 * credentials (`Authorization` Bearer + `X-Manager-Token`), and two of the three
 * call sites used to build the literal by hand and silently omit
 * `authorizationToken` / `authorizationTokenIv` — the merchant's own
 * "Re-register webhooks" button (`controllers/ecommerceWebhooks.ts`) and the
 * admin repair script (`scripts/reregister-webhooks.ts`). Both therefore threw
 * `Zid store <id> has no Authorization token — merchant must reconnect`, which
 * `registerWebhooksWithPersist` caught and persisted as `failed: [{topic:'all'}]`
 * plus a fresh Sentry error plus a fresh retry job: clicking the repair button
 * made the state worse, and the only working caller was the retry worker.
 *
 * A shared picker makes the omission impossible rather than merely reviewable
 * (prevention over detection) — a fourth call site cannot repeat it.
 */
export function toStoreForWebhooks(row: StoreForWebhooks): StoreForWebhooks {
    return {
        id: row.id,
        storeDomain: row.storeDomain,
        accessToken: row.accessToken,
        accessTokenIv: row.accessTokenIv,
        authorizationToken: row.authorizationToken,
        authorizationTokenIv: row.authorizationTokenIv,
    };
}

/**
 * Contract for e-commerce platform integrations (Shopify, Salla, Zid, ...).
 *
 * Each integration implements these hooks so core files (index.ts, auth.ts,
 * commentProcessor.ts, messageProcessor.ts, webhookRetryWorker.ts) never
 * import integration-specific code.
 */
export interface EcommerceIntegration {
    /** Unique name, e.g. 'shopify', 'salla', 'zid' */
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

    /**
     * Source-of-truth list of webhook topics this platform subscribes to.
     * Used by the webhook hardening UI and tests to know what's expected.
     */
    getWebhookTopics(): readonly string[];

    /**
     * Register webhooks for a connected store. Returns a structured status
     * (registered/failed/lastAttempt) so callers can persist it and surface
     * webhookHealth to the merchant. Errors during partial failures must NOT
     * throw — they go into `failed`. Throw only for total registration failure
     * (network error, auth failure) so the caller can persist-on-throw.
     */
    registerWebhooks(store: StoreForWebhooks): Promise<WebhookRegistrationResult>;
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

    /** Look up a registered integration by platform name. Returns null if unknown. */
    get(name: string): EcommerceIntegration | null {
        return this.integrations.find(i => i.name === name) ?? null;
    }
}

export const integrationRegistry = new IntegrationRegistryImpl();
