import { FastifyInstance } from 'fastify';
import * as zidController from '../controllers/zid';
import { createEcommerceRoutes } from './ecommerceRoutes';

const baseRoutes = createEcommerceRoutes('zid', zidController);

/**
 * Zid routes = the shared OAuth/CRUD set + the Embedded Apps session exchange.
 *
 * The embedded route is Zid-only (Salla/Shopify have no equivalent) and PUBLIC:
 * it runs inside Zid's dashboard iframe, a cross-site context where our
 * SameSite=strict auth cookies are never sent — the UUID Zid puts in the iframe
 * URL is the credential. See controllers/zid.ts embeddedSession.
 */
export default async function zidRoutes(fastify: FastifyInstance) {
    await fastify.register(baseRoutes);

    fastify.post('/embedded/session', zidController.embeddedSession);
}
