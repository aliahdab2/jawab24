import { FastifyInstance } from 'fastify';
import { instagramController } from '../controllers/instagram';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';

export default async function instagramRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        // Instagram Media
        protectedRoutes.get('/instagram/:pageId/media', {
            schema: { tags: ['Instagram'], summary: 'Get media for an Instagram page', security: auth },
        }, instagramController.getMedia);

        // Instagram Comments
        protectedRoutes.get('/instagram/media/:mediaId/comments', {
            schema: { tags: ['Instagram'], summary: 'Get comments for a media item', security: auth },
        }, instagramController.getComments);
        protectedRoutes.post('/instagram/comments/:commentId/reply', {
            schema: { tags: ['Instagram'], summary: 'Reply to a comment', security: auth },
        }, instagramController.replyToComment);

        // Toggle Instagram auto-reply
        protectedRoutes.patch('/pages/:id/instagram-auto-reply', {
            schema: { tags: ['Instagram'], summary: 'Toggle Instagram auto-reply for a page', security: auth },
        }, instagramController.toggleAutoReply);

        // Sync Instagram data for a page
        protectedRoutes.post('/instagram/:pageId/sync', {
            schema: { tags: ['Instagram'], summary: 'Sync Instagram media for a page', security: auth },
        }, instagramController.syncMedia);
    });
}
