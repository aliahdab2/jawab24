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

        adminRoutes.post('/pages/:pageId/catalog/batch', {
            schema: { tags: ['Catalog'], summary: 'Create multiple catalog items in one transaction', security: auth },
        }, catalogController.batchCreate.bind(catalogController));

        adminRoutes.patch('/pages/:pageId/catalog/:itemId', {
            schema: { tags: ['Catalog'], summary: 'Update a catalog item', security: auth },
        }, catalogController.update.bind(catalogController));

        adminRoutes.delete('/pages/:pageId/catalog/:itemId', {
            schema: { tags: ['Catalog'], summary: 'Delete a catalog item', security: auth },
        }, catalogController.remove.bind(catalogController));
    });
}
