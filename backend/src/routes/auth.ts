import { FastifyInstance } from 'fastify';
import { authController } from '../controllers/auth';
import { authenticate } from '../middleware/auth';

export default async function authRoutes(fastify: FastifyInstance) {
    // Public routes
    fastify.post('/auth/facebook', authController.facebookLogin);
    
    // Native Mobile Login (with schema validation)
    fastify.post('/auth/facebook/native', {
        schema: {
            body: {
                type: 'object',
                required: ['accessToken'],
                properties: {
                    accessToken: { type: 'string' }
                }
            }
        }
    }, authController.nativeLogin);

    // Protected routes
    fastify.get('/auth/me', { preHandler: [authenticate] }, authController.getMe);
    fastify.patch('/auth/profile', { preHandler: [authenticate] }, authController.updateProfile);
    fastify.delete('/auth/me', { preHandler: [authenticate] }, authController.deleteAccount);
}

