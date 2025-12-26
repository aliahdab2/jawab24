import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { instagramController } from '../controllers/instagram';
import { authenticate } from '../middleware/auth';

export default async function instagramRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        // Instagram Media
        protectedRoutes.get('/instagram/:pageId/media', instagramController.getMedia);
        
        // Instagram Comments
        protectedRoutes.get('/instagram/media/:mediaId/comments', instagramController.getComments);
        protectedRoutes.post('/instagram/comments/:commentId/reply', instagramController.replyToComment);
        
        // Toggle Instagram auto-reply
        protectedRoutes.patch('/pages/:id/instagram-auto-reply', instagramController.toggleAutoReply);
        
        // Sync Instagram data for a page
        protectedRoutes.post('/instagram/:pageId/sync', instagramController.syncMedia);
    });
}

