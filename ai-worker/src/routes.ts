import { FastifyInstance } from 'fastify';
import { openaiService, GenerateRequest } from './services/openai';
import { translationService, type TranslateRequest } from './services/translation';
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

    // Translate text endpoint
    server.post<{ Body: TranslateRequest }>('/translate', async (request, reply) => {
        const { text, sourceLanguage, targetLanguage } = request.body;

        // Validation
        if (!text || text.trim().length === 0) {
            return reply.status(400).send({ error: 'Text is required' });
        }
        if (!targetLanguage || !['ar', 'en'].includes(targetLanguage)) {
            return reply.status(400).send({ error: 'targetLanguage must be "ar" or "en"' });
        }
        if (sourceLanguage && !['ar', 'en', 'auto'].includes(sourceLanguage)) {
            return reply.status(400).send({ error: 'sourceLanguage must be "ar", "en", or "auto"' });
        }

        if (!translationService.isConfigured()) {
            return reply.status(503).send({ error: 'Translation service not configured' });
        }

        try {
            const result = await translationService.translate({
                text,
                sourceLanguage: sourceLanguage || 'auto',
                targetLanguage
            });
            return reply.send(result);
        } catch (error) {
            request.log.error(error, 'Failed to translate');
            Sentry.captureException(error, {
                extra: { sourceLanguage, targetLanguage, textLength: text.length }
            });
            return reply.status(500).send({
                error: error instanceof Error ? error.message : 'Failed to translate'
            });
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

        const settled = await Promise.allSettled(
            requests.map(req => openaiService.generateReply(req))
        );
        const results = settled.map((result, i) =>
            result.status === 'fulfilled'
                ? { success: true, ...result.value }
                : { success: false, error: 'Failed to generate reply', index: i }
        );

        // Report any failures to Sentry
        const failures = settled.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
            request.log.error({ failCount: failures.length, total: requests.length }, 'Partial batch failure');
            for (const f of failures) {
                Sentry.captureException((f as PromiseRejectedResult).reason);
            }
        }

        return reply.send({ results });
    });
}

export default routes;
