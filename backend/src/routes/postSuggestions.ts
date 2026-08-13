import { FastifyInstance } from 'fastify';
import { postSuggestionsController } from '../controllers/postSuggestions';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

// Malformed ids must 400 at the schema layer (repo pattern: admin/plans
// routes) — an invalid uuid otherwise reaches Postgres as a cast error (500),
// and on the generate path it would sit past the ownership/cap guards.
const pageParams = {
    type: 'object',
    properties: { pageId: { type: 'string', format: 'uuid' } },
    required: ['pageId'],
} as const;
const suggestionEventParams = {
    type: 'object',
    properties: {
        pageId: { type: 'string', format: 'uuid' },
        suggestionId: { type: 'string', format: 'uuid' },
    },
    required: ['pageId', 'suggestionId'],
} as const;

export default async function postSuggestionsRoutes(fastify: FastifyInstance) {
    // --- Reads + signal stamps: any workspace member ---
    fastify.register(async (memberRoutes) => {
        memberRoutes.addHook('preHandler', authenticate);
        memberRoutes.addHook('preHandler', resolveWorkspace);

        memberRoutes.get('/pages/:pageId/post-suggestions/today', {
            // The PATH is frozen (shipped bundles call it); the summary is not a
            // client contract, so it says what the route actually returns.
            schema: { tags: ['PostSuggestions'], summary: "The page's current suggested post, what is in flight, and earlier posts («إنشاء منشور» pilot)", security: auth, params: pageParams },
        }, postSuggestionsController.getCurrent.bind(postSuggestionsController));

        // Serves the card's bytes from our own origin so the browser can
        // actually download it (a bucket URL is displayable but not fetchable
        // without CORS). A READ of the merchant's own media — same audience as
        // the rest of this block.
        memberRoutes.get('/pages/:pageId/post-suggestions/:suggestionId/image', {
            schema: {
                tags: ['PostSuggestions'],
                summary: "Download today's post image (same-origin, so it is fetchable)",
                security: auth,
                params: suggestionEventParams,
                querystring: {
                    type: 'object',
                    properties: { variant: { type: 'integer', minimum: 0 } },
                },
            },
        }, postSuggestionsController.getImage.bind(postSuggestionsController));

        memberRoutes.post('/pages/:pageId/post-suggestions/:suggestionId/events', {
            schema: { tags: ['PostSuggestions'], summary: 'Stamp a market-signal event (opened/copied/downloaded)', security: auth, params: suggestionEventParams },
        }, postSuggestionsController.markEvent.bind(postSuggestionsController));

        // Picking a take costs nothing and changes no spend, so it sits with
        // the member reads rather than behind requireRole('admin') like generate.
        memberRoutes.put('/pages/:pageId/post-suggestions/:suggestionId/selection', {
            schema: { tags: ['PostSuggestions'], summary: 'Choose which take of the generation to publish', security: auth, params: suggestionEventParams },
        }, postSuggestionsController.selectVariant.bind(postSuggestionsController));
    });

    // --- Generation: workspace admin (paid LLM + image call) ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        // Paid route: rate-limited here, daily-capped (absolute, cron included)
        // in the service — same layering as catalog /extract.
        adminRoutes.post('/pages/:pageId/post-suggestions', {
            schema: { tags: ['PostSuggestions'], summary: "Generate or regenerate today's suggested post (text + image)", security: auth, params: pageParams },
            config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
        }, postSuggestionsController.generate.bind(postSuggestionsController));
    });
}
