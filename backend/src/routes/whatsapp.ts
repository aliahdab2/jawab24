import { FastifyInstance } from 'fastify';
import { whatsappController } from '../controllers/whatsapp';
import { whatsappRedirectController } from '../controllers/whatsappRedirect';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function whatsappRoutes(fastify: FastifyInstance) {
    // --- Toggle: admin+ (same gate as the page auto-reply toggle) ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        adminRoutes.patch('/pages/:id/whatsapp-auto-reply', {
            schema: { tags: ['WhatsApp'], summary: 'Toggle WhatsApp auto-reply for a page', security: auth },
        }, whatsappController.toggleAutoReply);
    });

    // --- Connect/disconnect: owner only — the Embedded Signup business token is
    //     workspace-level credential material, same rationale as /pages/sync. ---
    fastify.register(async (ownerRoutes) => {
        ownerRoutes.addHook('preHandler', authenticate);
        ownerRoutes.addHook('preHandler', resolveWorkspace);
        ownerRoutes.addHook('preHandler', requireRole('owner'));

        ownerRoutes.post('/pages/:id/connect-whatsapp', {
            schema: { tags: ['WhatsApp'], summary: 'Connect a WhatsApp Business number via Embedded Signup (owner only)', security: auth },
            config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        }, whatsappController.connect);

        ownerRoutes.post('/pages/connect-whatsapp', {
            schema: { tags: ['WhatsApp'], summary: 'Connect a WhatsApp-only number — creates a page card with no Facebook page (owner only)', security: auth },
            config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        }, whatsappController.connectNew);

        ownerRoutes.delete('/pages/:id/whatsapp', {
            schema: { tags: ['WhatsApp'], summary: 'Disconnect WhatsApp from a page (owner only)', security: auth },
        }, whatsappController.disconnect);

        // Redirect connect flow, leg 1: mint signed state + dialog URL. Same owner
        // scope as the popup connect. 404s while WHATSAPP_CONNECT_REDIRECT is off
        // (checked in the handler so rollback is an env flip, not a deploy).
        ownerRoutes.post('/auth/whatsapp/start', {
            schema: { tags: ['WhatsApp'], summary: 'Start the redirect Embedded Signup flow (owner only)', security: auth },
            config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        }, whatsappRedirectController.start);
    });

    // Native app connect leg: PUBLIC GET — a top-level navigation from the
    // system browser the app just opened, so it carries no session. The
    // single-use handoff code in the query IS the credential (same class as
    // the OAuth-code routes); the handler signs the browser in, mints the
    // state + nonce cookie, and 302s STRAIGHT to Meta's dialog — no JS
    // navigation anywhere for the device's browser surface to swallow.
    // Owner scope enforced inside the handler (membership role).
    fastify.get('/auth/whatsapp/app-start', {
        schema: {
            tags: ['WhatsApp'],
            summary: 'Native-app connect leg: consume a handoff code, sign the browser in, 302 to Meta',
            querystring: {
                type: 'object',
                required: ['code'],
                properties: {
                    code: { type: 'string', minLength: 20, maxLength: 128 },
                    pageId: { type: 'string' },
                    coexistence: { type: 'string' },
                    locale: { type: 'string' },
                    workspaceId: { type: 'string' },
                },
                additionalProperties: false,
            },
        },
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, whatsappRedirectController.appStart);

    // Redirect connect flow, leg 2: Meta 302s the merchant's browser here — a
    // top-level navigation with no Authorization header, so it is PUBLIC by
    // necessity. Authentication is the signed state + nonce cookie + a live
    // ownership re-verify inside the handler. Rate-limited like the other
    // public OAuth callback (auth/facebook/mobile-callback).
    fastify.get('/auth/whatsapp/callback', {
        schema: { tags: ['WhatsApp'], summary: 'OAuth return for the redirect Embedded Signup flow' },
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, whatsappRedirectController.callback);
}
