import { FastifyInstance } from 'fastify';
import { catalogController } from '../controllers/catalog';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function catalogRoutes(fastify: FastifyInstance) {
    // --- Reads: any workspace member ---
    fastify.register(async (memberRoutes) => {
        memberRoutes.addHook('preHandler', authenticate);
        memberRoutes.addHook('preHandler', resolveWorkspace);

        memberRoutes.get('/pages/:pageId/catalog', {
            schema: { tags: ['Catalog'], summary: 'List catalog items for a page', security: auth },
        }, catalogController.list.bind(catalogController));
    });

    // --- Writes: workspace admin or higher (mirrors KB edit rights) ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        adminRoutes.post('/pages/:pageId/catalog', {
            schema: { tags: ['Catalog'], summary: 'Add a catalog item', security: auth },
        }, catalogController.create.bind(catalogController));

        // Import flow. /extract is the only paid (LLM) route in this file —
        // rate-limited here, daily-capped in the controller; persists nothing.
        adminRoutes.post('/pages/:pageId/catalog/extract', {
            schema: { tags: ['Catalog'], summary: 'Extract proposed catalog items from free text (no persistence)', security: auth },
            config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        }, catalogController.extract.bind(catalogController));

        // Page scan (posts + configured Post Replies, D-059) — the priciest
        // route here (up to 10 Vision calls + one extraction per scan), so its
        // rate limit is tighter than /extract's. Path kept as scan-posts so
        // app builds shipped before the merge keep working.
        adminRoutes.post('/pages/:pageId/catalog/scan-posts', {
            schema: { tags: ['Catalog'], summary: "Read the page's recent posts + Post Reply auto-replies into proposed catalog items (no persistence)", security: auth },
            config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
        }, catalogController.scanPage.bind(catalogController));

        adminRoutes.post('/pages/:pageId/catalog/batch', {
            schema: { tags: ['Catalog'], summary: 'Create multiple catalog items in one transaction', security: auth },
        }, catalogController.batchCreate.bind(catalogController));

        // Registered before the param route: Fastify matches static segments
        // first anyway, but keeping /vertical above /:itemId makes that explicit.
        adminRoutes.patch('/pages/:pageId/catalog/vertical', {
            schema: { tags: ['Catalog'], summary: "Override the page's catalog business vertical", security: auth },
        }, catalogController.setVertical.bind(catalogController));

        adminRoutes.patch('/pages/:pageId/catalog/:itemId', {
            schema: { tags: ['Catalog'], summary: 'Update a catalog item', security: auth },
        }, catalogController.update.bind(catalogController));

        adminRoutes.delete('/pages/:pageId/catalog/:itemId', {
            schema: { tags: ['Catalog'], summary: 'Delete a catalog item', security: auth },
        }, catalogController.remove.bind(catalogController));
    });
}
