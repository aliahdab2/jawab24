import { FastifyInstance } from 'fastify';
import { authController } from '../controllers/auth';
import { authenticate } from '../middleware/auth';

export default async function authRoutes(fastify: FastifyInstance) {
    // Public routes
    fastify.post('/auth/facebook', authController.facebookLogin);

    // Protected routes
    fastify.get('/auth/me', { preHandler: [authenticate] }, authController.getMe);
}

