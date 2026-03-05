import { FastifyPluginAsync } from 'fastify';
import { translateText } from '../services/translation';
import { authenticate } from '../middleware/auth';
import { z } from 'zod';
import { validateSchema } from '../utils/validation';

const TranslateRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  sourceLanguage: z.enum(['ar', 'en', 'auto']).optional(),
  targetLanguage: z.enum(['ar', 'en'])
});

export const translationRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/translation/translate (stricter rate limit — calls OpenAI)
  fastify.post('/translate', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const validation = validateSchema(TranslateRequestSchema, request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: validation.errors
      });
    }

    const { text, sourceLanguage, targetLanguage } = validation.data;

    try {
      const result = await translateText({
        text,
        sourceLanguage: sourceLanguage || 'auto',
        targetLanguage
      });

      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Translation failed');
      return reply.code(500).send({
        error: 'Translation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
};
