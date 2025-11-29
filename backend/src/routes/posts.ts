import { FastifyInstance } from 'fastify';
import { postsController } from '../controllers/posts';
import { commentsController } from '../controllers/comments';
import { authenticate } from '../middleware/auth';

export default async function postsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        // Posts
        protectedRoutes.get('/posts', postsController.getAll);
        protectedRoutes.get('/posts/:id', postsController.getOne);
        protectedRoutes.put('/posts/:id', postsController.update);
        protectedRoutes.delete('/posts/:id', postsController.delete);
        protectedRoutes.patch('/posts/:id/auto-reply', postsController.toggleAutoReply);

        // Posts by page
        protectedRoutes.get('/pages/:pageId/posts', postsController.getByPage);

        // Comments by post
        protectedRoutes.get('/posts/:postId/comments', commentsController.getByPost);
    });
}

