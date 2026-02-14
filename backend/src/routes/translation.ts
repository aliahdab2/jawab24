import { FastifyPluginAsync } from 'fastify';
import { translateText } from '../services/translation';
import { authenticate } from '../middleware/auth';
import { z } from 'zod';

const TranslateRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  sourceLanguage: z.enum(['ar', 'en', 'auto']).optional(),
  targetLanguage: z.enum(['ar', 'en'])
});

export const translationRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/translation/translate
  fastify.post('/translate', {
    preHandler: [authenticate],
    schema: {
      body: TranslateRequestSchema
    }
  }, async (request, reply) => {
    const { text, sourceLanguage, targetLanguage } = request.body as z.infer<typeof TranslateRequestSchema>;

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
