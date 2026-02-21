import type { FastifyInstance } from 'fastify';
import type { EcommerceIntegration } from './registry';
import type { Logger } from '../types';
import { config } from '../config';

/**
 * Salla e-commerce integration stub.
 *
 * Salla is a leading Arab e-commerce platform (salla.sa).
 * This stub registers the integration slot so isEnabled() can return false
 * until the implementation is complete.
 *
 * Future implementation notes:
 * - Easy Mode: `app.store.authorize` webhook delivers access + refresh tokens (no OAuth callback needed)
 * - Token expiry: 14 days — must refresh proactively every ~13 days
 * - Products API: GET https://api.salla.dev/admin/v2/products (max 65/page, cursor pagination)
 * - Webhook verification: X-Salla-Signature header (SHA256 HMAC)
 * - Product events: product.created, product.price.updated, product.status.updated
 * - Auth URL: https://accounts.salla.sa/oauth2/auth
 * - Token URL: https://accounts.salla.sa/oauth2/token
 */
export class SallaIntegration implements EcommerceIntegration {
    readonly name = 'salla';

    isEnabled(): boolean {
        return !!config.salla?.clientId;
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
