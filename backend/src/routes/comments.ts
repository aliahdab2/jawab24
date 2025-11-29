import { FastifyInstance } from 'fastify';
import { commentsController } from '../controllers/comments';
import { authenticate } from '../middleware/auth';

export default async function commentsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        // Comments
        protectedRoutes.get('/comments', commentsController.getAll);
        protectedRoutes.get('/comments/inbox', commentsController.getInbox);
        protectedRoutes.get('/comments/stats', commentsController.getStats);
        protectedRoutes.get('/comments/:id', commentsController.getOne);
        protectedRoutes.put('/comments/:id', commentsController.update);
        protectedRoutes.delete('/comments/:id', commentsController.delete);

        // Reply to comment
        protectedRoutes.post('/comments/:id/reply', commentsController.reply);
    });
}

