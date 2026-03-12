import { FastifyInstance } from 'fastify';
import { openaiService, GenerateRequest } from './services/openai';
import { generateWithTools, generateWithToolResults, type ToolEnabledResponse } from './services/ecommerceToolHandler';
import { translationService, generateNudgeVariations, type TranslateRequest } from './services/translation';
import { generateReplyWithProvider, VALID_MODELS } from './services/providers';
import { Sentry } from './lib/sentry';
import { config } from './config';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';
import type { EcommerceToolResult } from '@jawab24/shared';

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
    server.post<{ Body: GenerateRequest & { model?: string } }>('/generate', async (request, reply) => {
        const { comment, language, context, model } = request.body;

        if (!comment || comment.trim().length === 0) {
            return reply.status(400).send({ error: 'Comment is required' });
        }

        // Non-default model → route through provider abstraction
        if (model && model !== DEFAULT_AI_MODEL) {
            if (!VALID_MODELS.has(model)) {
                return reply.status(400).send({ error: `Unknown model: ${model}` });
            }
            try {
                const result = await generateReplyWithProvider({ comment, language, context }, model);
                return reply.send(result);
            } catch (error) {
                request.log.error(error, 'Failed to generate reply with provider');
                Sentry.captureException(error, { extra: { comment, language, model } });
                return reply.status(500).send({ error: 'Failed to generate reply' });
            }
        }

        // Default model → unchanged production path
        try {
            const result = await openaiService.generateReply({ comment, language, context });
            return reply.send(result);
        } catch (error) {
            request.log.error(error, 'Failed to generate reply');
            Sentry.captureException(error, { extra: { comment, language } });
            return reply.status(500).send({ error: 'Failed to generate reply' });
        }
    });

    // Generate reply with e-commerce tools available (initial call)
    server.post<{ Body: GenerateRequest }>('/generate-with-tools', async (request, reply) => {
        const { comment, language, context } = request.body;

        if (!comment || comment.trim().length === 0) {
            return reply.status(400).send({ error: 'Comment is required' });
        }

        try {
            const result = await generateWithTools({ comment, language, context });
            return reply.send(result);
        } catch (error) {
            request.log.error(error, 'Failed to generate reply with tools');
            Sentry.captureException(error, { extra: { comment, language } });
            return reply.status(500).send({ error: 'Failed to generate reply with tools' });
        }
    });

    // Complete generation after tool results are available
    server.post<{
        Body: {
            originalRequest: GenerateRequest;
            toolResults: EcommerceToolResult[];
            originalToolCalls: Array<{ name: string; arguments: Record<string, string> }>;
        };
    }>('/generate-with-tool-results', async (request, reply) => {
        const { originalRequest, toolResults, originalToolCalls } = request.body;

        if (!originalRequest?.comment || !Array.isArray(toolResults) || !Array.isArray(originalToolCalls)
            || toolResults.length === 0 || toolResults.length !== originalToolCalls.length) {
            return reply.status(400).send({ error: 'originalRequest, toolResults (array), and originalToolCalls (array, same length) are required' });
        }

        try {
            const result = await generateWithToolResults(originalRequest, toolResults, originalToolCalls);
            return reply.send(result);
        } catch (error) {
            request.log.error(error, 'Failed to generate reply with tool results');
            Sentry.captureException(error, { extra: { toolCount: toolResults.length } });
            return reply.status(500).send({ error: 'Failed to generate reply with tool results' });
        }
    });

    // Translate text endpoint
    server.post<{ Body: TranslateRequest }>('/translate', async (request, reply) => {
        const { text, sourceLanguage, targetLanguage } = request.body;

        // Validation
        if (!text || text.trim().length === 0) {
            return reply.status(400).send({ error: 'Text is required' });
        }
        if (!targetLanguage || typeof targetLanguage !== 'string' || targetLanguage.length < 2) {
            return reply.status(400).send({ error: 'targetLanguage is required' });
        }
        if (sourceLanguage && (typeof sourceLanguage !== 'string' || sourceLanguage.length < 2)) {
            return reply.status(400).send({ error: 'sourceLanguage must be a valid language code or "auto"' });
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

    // Generate nudge variations endpoint (for anti-spam rotation in dual mode)
    server.post<{ Body: { text: string; language: string; count?: number } }>('/generate-variations', async (request, reply) => {
        const { text, language, count } = request.body;

        if (!text || text.trim().length === 0) {
            return reply.status(400).send({ error: 'Text is required' });
        }
        if (!language || typeof language !== 'string') {
            return reply.status(400).send({ error: 'Language is required' });
        }

        if (!translationService.isConfigured()) {
            return reply.status(503).send({ error: 'AI service not configured' });
        }

        try {
            const result = await generateNudgeVariations(text, language, count || 10);
            return reply.send(result);
        } catch (error) {
            request.log.error(error, 'Failed to generate variations');
            Sentry.captureException(error, {
                extra: { language, textLength: text.length }
            });
            return reply.status(500).send({
                error: error instanceof Error ? error.message : 'Failed to generate variations'
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
