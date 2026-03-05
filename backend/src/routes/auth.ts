import { FastifyInstance } from 'fastify';
import { authController } from '../controllers/auth';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';

export default async function authRoutes(fastify: FastifyInstance) {
    // Public routes (stricter rate limit — prevent brute force)
    const authRateLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

    fastify.post('/auth/facebook', {
        ...authRateLimit,
        schema: {
            tags: ['Auth'],
            summary: 'Login with Facebook OAuth redirect',
        },
    }, authController.facebookLogin);

    // Native Mobile Login (with schema validation)
    fastify.post('/auth/facebook/native', {
        ...authRateLimit,
        schema: {
            tags: ['Auth'],
            summary: 'Login with Facebook access token (native mobile)',
            body: {
                type: 'object',
                required: ['accessToken'],
                properties: {
                    accessToken: { type: 'string' }
                }
            }
        }
    }, authController.nativeLogin);

    // Logout
    fastify.post('/auth/logout', {
        schema: {
            tags: ['Auth'],
            summary: 'Logout and invalidate session',
        },
    }, authController.logout);

    // Refresh Token
    fastify.post('/auth/refresh', {
        schema: {
            tags: ['Auth'],
            summary: 'Refresh access token',
        },
    }, authController.refresh);

    // Protected routes
    fastify.get('/auth/picture/refresh', {
        schema: {
            tags: ['Auth'],
            summary: 'Refresh profile picture URL from Facebook',
            security: auth,
        },
        preHandler: [authenticate],
    }, authController.refreshPicture);

    fastify.get('/auth/me', {
        schema: {
            tags: ['Auth'],
            summary: 'Get current user profile',
            security: auth,
        },
        preHandler: [authenticate],
    }, authController.getMe);

    fastify.patch('/auth/profile', {
        schema: {
            tags: ['Auth'],
            summary: 'Update current user profile',
            security: auth,
            body: {
                type: 'object',
                properties: {
                    email: { type: 'string', format: 'email', maxLength: 255 },
                    name: { type: 'string', minLength: 1, maxLength: 255 },
                },
                additionalProperties: false,
            },
        },
        preHandler: [authenticate],
    }, authController.updateProfile);

    fastify.delete('/auth/me', {
        schema: {
            tags: ['Auth'],
            summary: 'Delete current user account',
            security: auth,
        },
        preHandler: [authenticate],
    }, authController.deleteAccount);
}
