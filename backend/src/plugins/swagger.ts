import { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { registerPlugin } from '../utils/register-plugin';

export default async function swaggerPlugin(fastify: FastifyInstance) {
    await registerPlugin(fastify, swagger, {
        openapi: {
            openapi: '3.0.3',
            info: {
                title: 'Jawab24 API',
                description: 'Facebook & Instagram auto-reply platform API. Manage pages, comments, messages, AI replies, templates, rules, and subscriptions.',
                version: '1.0.0',
            },
            servers: [
                { url: 'http://localhost:3000', description: 'Development' },
                { url: 'https://jawab24.com/api', description: 'Production' },
            ],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                        description: 'JWT token from /auth/facebook login',
                    },
                },
            },
            tags: [
                { name: 'Auth', description: 'Authentication & user profile' },
                { name: 'Pages', description: 'Facebook/Instagram page management' },
                { name: 'Posts', description: 'Post management' },
                { name: 'Comments', description: 'Comment management & replies' },
                { name: 'Messages', description: 'Direct message management' },
                { name: 'Instagram', description: 'Instagram-specific endpoints' },
                { name: 'AI', description: 'AI reply generation' },
                { name: 'Rules', description: 'Auto-reply rules' },
                { name: 'Templates', description: 'Reply templates' },
                { name: 'Settings', description: 'User settings' },
                { name: 'Plans', description: 'Subscription plans' },
                { name: 'Subscriptions', description: 'User subscription management' },
                { name: 'Payment', description: 'Stripe payment & billing' },
                { name: 'Notifications', description: 'Push notifications & in-app alerts' },
                { name: 'Admin', description: 'Admin-only endpoints' },
                { name: 'Webhooks', description: 'Facebook webhook handlers' },
                { name: 'Health', description: 'Health checks & monitoring' },
                { name: 'Geo', description: 'Geolocation & sanctions' },
            ],
        },
    });

    await registerPlugin(fastify, swaggerUi, {
        routePrefix: '/docs',
        uiConfig: {
            docExpansion: 'list',
            deepLinking: true,
            defaultModelsExpandDepth: 1,
        },
    });
}
