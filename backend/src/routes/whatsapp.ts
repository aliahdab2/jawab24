import { FastifyInstance } from 'fastify';
import { whatsappController } from '../controllers/whatsapp';
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
    });
}
