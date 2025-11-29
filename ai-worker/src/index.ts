import fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { config } from './config';
import { openaiService, GenerateRequest } from './services/openai';

dotenv.config();

const server = fastify({
    logger: true,
});

// Health check
server.get('/health', async () => {
    return {
        status: 'ok',
        service: 'ai-worker',
        openaiConfigured: openaiService.isConfigured(),
        timestamp: new Date().toISOString(),
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
        request.log.error(error);
        return reply.status(500).send({ error: 'Failed to generate reply' });
    }
});

// Batch generate endpoint (for future use)
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
        request.log.error(error);
        return reply.status(500).send({ error: 'Failed to generate replies' });
    }
});

// Status endpoint
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

const start = async () => {
    try {
        await server.register(cors);

        await server.listen({ port: config.port, host: '0.0.0.0' });
        console.log(`AI Worker listening on http://0.0.0.0:${config.port}`);
        console.log(`OpenAI configured: ${openaiService.isConfigured()}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();

