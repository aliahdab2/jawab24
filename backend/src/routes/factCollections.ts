import { FastifyInstance } from 'fastify';
import { factCollectionsController } from '../controllers/factCollections';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

/**
 * Fact-collections list editor (G1b) — same auth split as the catalog:
 * any member may read, workspace admin may write (mirrors KB edit rights).
 * No LLM routes here, so no rate limits beyond the global ones.
 */
export default async function factCollectionsRoutes(fastify: FastifyInstance) {
    // --- Reads: any workspace member ---
    fastify.register(async (memberRoutes) => {
        memberRoutes.addHook('preHandler', authenticate);
        memberRoutes.addHook('preHandler', resolveWorkspace);

        memberRoutes.get('/pages/:pageId/fact-collections', {
            schema: { tags: ['FactCollections'], summary: "List a page's fact collections with their rows", security: auth },
        }, factCollectionsController.list.bind(factCollectionsController));
    });

    // --- Writes: workspace admin or higher ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        adminRoutes.post('/pages/:pageId/fact-collections', {
            schema: { tags: ['FactCollections'], summary: 'Create a collection with its first rows (merchant «add list»)', security: auth },
        }, factCollectionsController.createCollection.bind(factCollectionsController));

        adminRoutes.post('/pages/:pageId/fact-collections/:collectionId/rows', {
            schema: { tags: ['FactCollections'], summary: 'Add a row to a collection', security: auth },
        }, factCollectionsController.addRow.bind(factCollectionsController));

        adminRoutes.patch('/pages/:pageId/fact-collections/:collectionId/rows/:rowId', {
            schema: { tags: ['FactCollections'], summary: 'Update a row', security: auth },
        }, factCollectionsController.updateRow.bind(factCollectionsController));

        adminRoutes.delete('/pages/:pageId/fact-collections/:collectionId/rows/:rowId', {
            schema: { tags: ['FactCollections'], summary: 'Delete a row (the last row is protected)', security: auth },
        }, factCollectionsController.deleteRow.bind(factCollectionsController));

        adminRoutes.put('/pages/:pageId/fact-entity', {
            schema: { tags: ['FactCollections'], summary: 'Atomically save one entity (row upserts + deletes across collections)', security: auth },
        }, factCollectionsController.saveEntity.bind(factCollectionsController));

        adminRoutes.patch('/pages/:pageId/fact-collections/:collectionId/completeness', {
            schema: { tags: ['FactCollections'], summary: "Set the merchant's completeness declaration (tri-state)", security: auth },
        }, factCollectionsController.setCompleteness.bind(factCollectionsController));
    });
}
