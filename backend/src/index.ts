import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import webhookRoutes from './routes/webhook';
import rulesRoutes from './routes/rules';
import templatesRoutes from './routes/templates';
import aiRoutes from './routes/ai';
import pagesRoutes from './routes/pages';
import postsRoutes from './routes/posts';
import commentsRoutes from './routes/comments';
import settingsRoutes from './routes/settings';
import messagesRoutes from './routes/messages';
import instagramRoutes from './routes/instagram';
import versionRoutes from './routes/version';
import plansRoutes from './routes/plans';
import subscriptionsRoutes from './routes/subscriptions';
import paymentRoutes from './routes/payment';
import { errorHandler } from './middleware/errorHandler';
import { requestIdMiddleware } from './middleware/requestId';
import { validateEnv } from './utils/env';

dotenv.config();

// ⚡ Validate environment variables on startup
try {
    validateEnv();
    console.log('✅ Environment variables validated successfully');
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

const server = fastify({
    logger: {
        level: process.env.LOG_LEVEL || 'info',
        serializers: {
            req(request) {
                return {
                    method: request.method,
                    url: request.url,
                    headers: request.headers,
                    hostname: request.hostname,
                    remoteAddress: request.ip,
                    remotePort: request.socket.remotePort,
                };
            },
        },
    },
    bodyLimit: 10485760, // 10MB
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
});

// Add rawBody support for Stripe webhooks
server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
        try {
            (req as any).rawBody = body;
            const json = JSON.parse(body.toString('utf8'));
            done(null, json);
        } catch (err: any) {
            err.statusCode = 400;
            done(err, undefined);
        }
    }
);

const start = async () => {
    try {
        // Set global error handler
        server.setErrorHandler(errorHandler);

        // Add request ID middleware (must be first)
        server.addHook('onRequest', requestIdMiddleware);

        // Register plugins
        await server.register(cors, {
            origin: process.env.FRONTEND_URL || 'http://localhost:3001',
            credentials: true,
        });
        
        await server.register(helmet, {
            contentSecurityPolicy: false, // Disable for API
        });

        // Register rate limiting
        await server.register(rateLimit, {
            max: 100, // 100 requests
            timeWindow: '15 minutes',
            errorResponseBuilder: (request, context) => ({
                error: true,
                message: 'Rate limit exceeded. Please try again later.',
                code: 'RATE_LIMIT_EXCEEDED',
                retryAfter: context.after,
            }),
        });

        // Register routes
        await server.register(healthRoutes);
        await server.register(versionRoutes);
        await server.register(authRoutes);
        await server.register(webhookRoutes);
        await server.register(rulesRoutes);
        await server.register(templatesRoutes);
        await server.register(aiRoutes);
        await server.register(pagesRoutes);
        await server.register(postsRoutes);
        await server.register(commentsRoutes);
        await server.register(settingsRoutes);
        await server.register(messagesRoutes);
        await server.register(instagramRoutes);
        await server.register(plansRoutes, { prefix: '/plans' });
        await server.register(subscriptionsRoutes, { prefix: '/subscription' });
        await server.register(paymentRoutes, { prefix: '/payment' });

        const port = parseInt(process.env.PORT || '3000', 10);
        const host = '0.0.0.0';

        await server.listen({ port, host });
        console.log(`🚀 Server listening on http://${host}:${port}`);
        console.log(`📊 Health check: http://${host}:${port}/health`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received, closing server gracefully...`);
    
    try {
        await server.close();
        console.log('✅ Server closed successfully');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error during shutdown:', err);
        process.exit(1);
    }
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
});

start();
