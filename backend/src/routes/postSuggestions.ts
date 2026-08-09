import { FastifyInstance } from 'fastify';
import { postSuggestionsController } from '../controllers/postSuggestions';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function postSuggestionsRoutes(fastify: FastifyInstance) {
    // --- Reads + signal stamps: any workspace member ---
    fastify.register(async (memberRoutes) => {
        memberRoutes.addHook('preHandler', authenticate);
        memberRoutes.addHook('preHandler', resolveWorkspace);

        memberRoutes.get('/pages/:pageId/post-suggestions/today', {
            schema: { tags: ['PostSuggestions'], summary: "Today's suggested post («بوست اليوم» pilot)", security: auth },
        }, postSuggestionsController.getToday.bind(postSuggestionsController));

        memberRoutes.post('/pages/:pageId/post-suggestions/:suggestionId/events', {
            schema: { tags: ['PostSuggestions'], summary: 'Stamp a market-signal event (opened/copied/downloaded)', security: auth },
        }, postSuggestionsController.markEvent.bind(postSuggestionsController));
    });

    // --- Generation: workspace admin (paid LLM + image call) ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        // Paid route: rate-limited here, daily-capped (absolute, cron included)
        // in the service — same layering as catalog /extract.
        adminRoutes.post('/pages/:pageId/post-suggestions', {
            schema: { tags: ['PostSuggestions'], summary: "Generate or regenerate today's suggested post (text + image)", security: auth },
            config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
        }, postSuggestionsController.generate.bind(postSuggestionsController));
    });
}
