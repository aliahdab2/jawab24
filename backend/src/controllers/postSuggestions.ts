import { FastifyReply, FastifyRequest } from 'fastify';
import type { PostSuggestionEvent, PostSuggestionPostType } from '@jawab24/shared';
import { postSuggestionsService, isPostSuggestionsEnabledForPage } from '../services/postSuggestions';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

const EVENTS: readonly PostSuggestionEvent[] = ['opened', 'copied', 'downloaded'];
const POST_TYPES: readonly PostSuggestionPostType[] = ['promo', 'product_spotlight', 'faq_tip', 'hours_reminder', 'general'];

/**
 * «بوست اليوم» pilot — /pages/:pageId/post-suggestions.
 *
 * Dark-feature posture: a page outside the env gate gets a plain 404 from
 * every route, indistinguishable from the route not existing — the pilot must
 * be invisible to non-allowlisted accounts (same as the WhatsApp canary).
 * Ownership: every service call is scoped by (workspaceId, pageId); a foreign
 * page 404s (never 403 — don't leak existence).
 */
class PostSuggestionsController {
    /** GET /pages/:pageId/post-suggestions/today */
    async getToday(
        request: FastifyRequest<{ Params: { pageId: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId } = request.params;
        if (!isPostSuggestionsEnabledForPage(pageId)) return reply.status(404).send({ error: 'Not found' });

        const result = await postSuggestionsService.getToday(req.workspaceId, pageId);
        return reply.send(result);
    }

    /** POST /pages/:pageId/post-suggestions — generate or regenerate today's post. */
    async generate(
        request: FastifyRequest<{ Params: { pageId: string }; Body: { includeContact?: boolean; postType?: string } | null }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId } = request.params;
        // Merchant toggle for the code-composed contact footer; default ON.
        const includeContact = request.body?.includeContact !== false;
        // Merchant-chosen angle — unknown values rejected, absent = variety picker.
        const rawType = request.body?.postType;
        if (rawType !== undefined && !(POST_TYPES as readonly string[]).includes(rawType)) {
            return reply.status(400).send({ error: `postType must be one of: ${POST_TYPES.join(', ')}` });
        }

        const result = await postSuggestionsService.generateSuggestion(req.workspaceId, pageId, 'manual', {
            includeContact,
            ...(rawType ? { postType: rawType as PostSuggestionPostType } : {}),
        });
        if (result.ok) {
            return reply.send({
                suggestion: result.suggestion,
                remainingToday: result.remainingToday,
                ...(result.imageDegraded ? { imageDegraded: result.imageDegraded } : {}),
            });
        }
        switch (result.reason) {
            case 'gated':
            case 'page_not_found':
                return reply.status(404).send({ error: 'Not found' });
            case 'daily_cap':
                return reply.status(429).send({ error: 'Daily generation limit reached. Try again tomorrow.', code: 'daily_cap' });
            case 'cap_check_unavailable':
                // Fail closed — the cap is the only bound on real spend
                // (same policy as catalog extract / KB Vision).
                return reply.status(503).send({ error: 'Quota check unavailable. Try again shortly.', code: 'quota_check_unavailable' });
            case 'generation_failed':
                return reply.status(502).send({ error: 'Generation failed. Try again.', code: 'generation_failed' });
        }
    }

    /** POST /pages/:pageId/post-suggestions/:suggestionId/events — market-signal stamps. */
    async markEvent(
        request: FastifyRequest<{ Params: { pageId: string; suggestionId: string }; Body: { event?: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId, suggestionId } = request.params;
        if (!isPostSuggestionsEnabledForPage(pageId)) return reply.status(404).send({ error: 'Not found' });

        const event = request.body?.event;
        if (!event || !(EVENTS as readonly string[]).includes(event)) {
            return reply.status(400).send({ error: `event must be one of: ${EVENTS.join(', ')}` });
        }

        const found = await postSuggestionsService.markEvent(req.workspaceId, pageId, suggestionId, event as PostSuggestionEvent);
        if (!found) return reply.status(404).send({ error: 'Not found' });
        return reply.status(204).send();
    }
}

export const postSuggestionsController = new PostSuggestionsController();
