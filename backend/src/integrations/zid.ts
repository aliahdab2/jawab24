import type { FastifyInstance } from 'fastify';
import type { EcommerceIntegration } from './registry';
import type { Logger } from '../types';
import { config } from '../config';

/**
 * Zid e-commerce integration stub.
 *
 * Zid is a leading Arab e-commerce platform (zid.sa).
 * This stub registers the integration slot so isEnabled() can return false
 * until the implementation is complete.
 *
 * Future implementation notes:
 * - Auth URL: https://oauth.zid.sa/oauth/authorize
 * - Token URL: https://oauth.zid.sa/oauth/token
 * - Auth header: X-MANAGER-TOKEN (NOT Authorization: Bearer — unique to Zid)
 * - Token expiry: 1 year — refresh before 10 months to be safe
 * - Products API: GET https://api.zid.sa/v1/products
 * - Webhook verification: SHA256 HMAC (header name TBD)
 * - Refresh token: required (stored encrypted in ecommerce_stores.refresh_token)
 */
export class ZidIntegration implements EcommerceIntegration {
    readonly name = 'zid';

    isEnabled(): boolean {
        return !!config.zid?.clientId;
    }

    async registerRoutes(_fastify: FastifyInstance): Promise<void> {
        // Not yet implemented
    }

    async enrichKnowledgeBase(): Promise<null> {
        return null;
    }

    async claimPendingInstall(): Promise<null> {
        return null;
    }

    async onStartup(_logger: Logger): Promise<void> {
        // Not yet implemented
    }

    async onShutdown(): Promise<void> {
        // Not yet implemented
    }
}
