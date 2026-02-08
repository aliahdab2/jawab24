import { FastifyInstance } from 'fastify';
import { openaiService, GenerateRequest } from './services/openai';
import { Sentry } from './lib/sentry';
import { config } from './config';

async function routes(server: FastifyInstance) {
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

    // Generate reply endpoint
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

    // Batch generate endpoint
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
}

export default routes;
