import dotenv from 'dotenv';
dotenv.config();

// Initialize Sentry FIRST
import { initSentry, Sentry } from './lib/sentry';
initSentry();

import fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { openaiService, GenerateRequest } from './services/openai';

const server = fastify({
    logger: true,
});

// Health check (no rate limit)
server.get('/health', async () => {
    return {
        status: 'ok',
        service: 'ai-worker',
        openaiConfigured: openaiService.isConfigured(),
        timestamp: new Date().toISOString(),
    };
});

// Status endpoint (no rate limit)
server.get('/status', async () => {
    return {
        service: 'ai-worker',
        version: '1.0.0',
        openai: {
            configured: openaiService.isConfigured(),
            model: config.openai.model,
        },
        config: {
            maxTokens: config.openai.maxTokens,
            temperature: config.openai.temperature,
        },
    };
});

// Generate reply endpoint with rate limiting
server.post<{ Body: GenerateRequest }>('/generate', async (request, reply) => {
    const { comment, language, context } = request.body;

    if (!comment || comment.trim().length === 0) {
        return reply.status(400).send({ error: 'Comment is required' });
    }

    try {
        const result = await openaiService.generateReply({ comment, language, context });
        return reply.send(result);
    } catch (error) {
        request.log.error(error, 'Failed to generate reply');
        Sentry.captureException(error, { extra: { comment, language } });
        return reply.status(500).send({ error: 'Failed to generate reply' });
    }
});

// Batch generate endpoint with rate limiting
server.post<{ Body: { requests: GenerateRequest[] } }>('/generate/batch', async (request, reply) => {
    const { requests } = request.body;

    if (!requests || !Array.isArray(requests) || requests.length === 0) {
        return reply.status(400).send({ error: 'Requests array is required' });
    }

    if (requests.length > 10) {
        return reply.status(400).send({ error: 'Maximum 10 requests per batch' });
    }

    try {
        const results = await Promise.all(
            requests.map(req => openaiService.generateReply(req))
        );
        return reply.send({ results });
    } catch (error) {
        request.log.error(error, 'Failed to generate batch replies');
        Sentry.captureException(error);
        return reply.status(500).send({ error: 'Failed to generate replies' });
    }
});

const start = async () => {
    try {
        const isProduction = process.env.NODE_ENV === 'production';
        await server.register(cors, {
            origin: isProduction
                ? (process.env.CORS_ORIGIN || false)  // Block all if not configured in production
                : true,                                // Allow all in development
        });

        // Register rate limiting
        await server.register(rateLimit, {
            max: 100, // 100 requests per minute per IP
            timeWindow: '1 minute',
            errorResponseBuilder: () => ({
                error: 'Rate limit exceeded',
                message: 'Too many requests. Please try again later.',
                statusCode: 429,
            }),
        });

        await server.listen({ port: config.port, host: '0.0.0.0' });
        server.log.info(`AI Worker listening on http://0.0.0.0:${config.port}`);
        server.log.info(`OpenAI configured: ${openaiService.isConfigured()}`);

        // Initialize BullMQ Worker
        const { Worker } = await import('bullmq');
        const { AI_QUEUE_NAME } = await import('@jawab24/shared');

        const connection = {
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
        };

        const worker = new Worker(AI_QUEUE_NAME, async (job) => {
            server.log.info({ jobId: job.id }, 'Processing job');
            const { comment, language, context } = job.data;
            try {
                const result = await openaiService.generateReply({ comment, language, context });
                return result;
            } catch (error) {
                server.log.error({ jobId: job.id, error }, 'Job failed');
                Sentry.captureException(error, { extra: { jobId: job.id, comment, language } });
                throw error;
            }
        }, {
            connection,
            concurrency: config.queue.concurrency
        });

        worker.on('completed', (job) => {
            server.log.info({ jobId: job.id }, 'Job completed');
        });

        worker.on('failed', (job, err) => {
            server.log.error({ jobId: job?.id, err }, 'Job failed');
        });

        // Store worker for shutdown
        (global as any).aiWorker = worker;

    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
    server.log.info(`${signal} received, closing AI worker gracefully...`);

    try {
        await server.close();
        if ((global as any).aiWorker) {
            await (global as any).aiWorker.close();
        }
        server.log.info('AI Worker closed successfully');
        process.exit(0);
    } catch (err) {
        server.log.error(err, 'Error during shutdown');
        process.exit(1);
    }
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    server.log.error(error, 'Uncaught Exception');
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    server.log.error({ reason, promise }, 'Unhandled Rejection');
    gracefulShutdown('UNHANDLED_REJECTION');
});

start();

