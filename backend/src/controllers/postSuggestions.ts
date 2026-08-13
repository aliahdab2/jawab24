import { FastifyReply, FastifyRequest } from 'fastify';
import { POST_SUGGESTION_BRIEF_MAX, type PostSuggestionEvent, type PostSuggestionPostType, type PostSuggestionResponse } from '@jawab24/shared';
import { postSuggestionsService, isPostSuggestionsEnabledForWorkspace } from '../services/postSuggestions';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';

const EVENTS: readonly PostSuggestionEvent[] = ['opened', 'copied', 'downloaded'];
const POST_TYPES: readonly PostSuggestionPostType[] = ['promo', 'product_spotlight', 'faq_tip', 'hours_reminder', 'general'];

/**
 * One of the merchant's free-text request boxes, validated.
 *
 * Shared by both boxes rather than written twice: they have identical rules, and
 * two copies is how one of them silently loses its length cap. The field NAME is
 * deferred to the error thunk so the message can still say which box failed.
 */
function readRequestField(raw: unknown): {
    value: string;
    error: ((field: string) => { error: string; code?: string }) | null;
} {
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
        return { value: '', error: (field) => ({ error: `${field} must be a string` }) };
    }
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length > POST_SUGGESTION_BRIEF_MAX) {
        return {
            value: '',
            error: (field) => ({
                error: `${field} must be at most ${POST_SUGGESTION_BRIEF_MAX} characters`,
                code: 'brief_too_long',
            }),
        };
    }
    return { value, error: null };
}

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
    /**
     * GET /pages/:pageId/post-suggestions/today
     *
     * ⚠️ The PATH still says `today`; the behaviour no longer does. It returns
     * the page's current post whenever it was made, whatever attempt is in
     * flight, and the earlier posts (owner ruling 2026-08-13 — generation on
     * demand). The URL is kept because
     * shipped mobile bundles call it: Waleed's Android 2.0.26 predates even the
     * feature gate, and renaming a live path would 404 every one of them. A URL
     * is a contract with clients we cannot redeploy, so it outlives the wording.
     */
    async getCurrent(
        request: FastifyRequest<{ Params: { pageId: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId } = request.params;
        if (!isPostSuggestionsEnabledForWorkspace(req.workspaceId)) return reply.status(404).send({ error: 'Not found' });

        const result = await postSuggestionsService.getCurrent(req.workspaceId, pageId);
        // Null = the page isn't in this workspace — same 404 the sibling
        // routes return (never leak a foreign page's cap counter).
        if (!result) return reply.status(404).send({ error: 'Not found' });
        const body: PostSuggestionResponse = result;
        return reply.send(body);
    }

    /** POST /pages/:pageId/post-suggestions — generate or regenerate today's post. */
    async generate(
        request: FastifyRequest<{ Params: { pageId: string }; Body: { includeContact?: boolean; postType?: string; brief?: unknown; imageRequest?: unknown } | null }>,
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

        // What the merchant asked this post to say, and what they asked the
        // picture to show. Validated for TYPE and LENGTH only — the content is
        // free text by design and is defended at the prompt boundary (its own
        // delimited block), not by trying to sanitise natural language, which
        // does not work.
        const brief = readRequestField(request.body?.brief);
        if (brief.error) return reply.status(400).send(brief.error('brief'));
        const imageRequest = readRequestField(request.body?.imageRequest);
        if (imageRequest.error) return reply.status(400).send(imageRequest.error('imageRequest'));

        const result = await postSuggestionsService.requestSuggestion(req.workspaceId, pageId, 'manual', {
            includeContact,
            ...(rawType ? { postType: rawType as PostSuggestionPostType } : {}),
            // Omitted when empty so an untouched box is indistinguishable from
            // a client that predates the field.
            ...(brief.value ? { brief: brief.value } : {}),
            ...(imageRequest.value ? { imageRequest: imageRequest.value } : {}),
        });
        if (result.ok) {
            // Same envelope as getCurrent — typed against the shared shape so
            // the two routes can never drift apart silently.
            // No `history`: this route answers with a pending row, so the list
            // would be one behind by construction. The client polls the read
            // route, which answers it correctly.
            const body: PostSuggestionResponse = {
                suggestion: result.suggestion,
                inFlight: result.inFlight,
                remainingToday: result.remainingToday,
                availableTypes: result.availableTypes,
            };
            return reply.send(body);
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

    /**
     * PUT /pages/:pageId/post-suggestions/:suggestionId/selection — which take
     * the merchant picked. PUT, not POST: setting the selection is idempotent
     * and replaces the previous choice.
     */
    async selectVariant(
        request: FastifyRequest<{ Params: { pageId: string; suggestionId: string }; Body: { variantIndex?: unknown } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId, suggestionId } = request.params;
        if (!isPostSuggestionsEnabledForWorkspace(req.workspaceId)) return reply.status(404).send({ error: 'Not found' });

        const variantIndex = request.body?.variantIndex;
        if (typeof variantIndex !== 'number' || !Number.isInteger(variantIndex) || variantIndex < 0) {
            return reply.status(400).send({ error: 'variantIndex must be a non-negative integer' });
        }

        // Null covers both "not this workspace's row" and "no such take" — the
        // second is a 404 on purpose: an index this row cannot serve addresses
        // nothing, and reporting it as a validation error would tell a caller
        // how many takes a row it cannot see happens to have.
        const suggestion = await postSuggestionsService.selectVariant(req.workspaceId, pageId, suggestionId, variantIndex);
        if (!suggestion) return reply.status(404).send({ error: 'Not found' });
        return reply.send({ suggestion });
    }

    /**
     * GET /pages/:pageId/post-suggestions/:suggestionId/image — the card, served
     * from OUR origin.
     *
     * The browser can DISPLAY a bucket URL without permission but cannot FETCH
     * one without CORS headers, and downloading requires a fetch — so «حفظ
     * الصورة» failed on every press from the day it shipped. Serving the bytes
     * ourselves removes the cross-origin question instead of depending on bucket
     * configuration that lives outside this repo.
     */
    async getImage(
        request: FastifyRequest<{ Params: { pageId: string; suggestionId: string }; Querystring: { variant?: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId, suggestionId } = request.params;
        if (!isPostSuggestionsEnabledForWorkspace(req.workspaceId)) return reply.status(404).send({ error: 'Not found' });

        const raw = request.query?.variant;
        let variantIndex: number | undefined;
        if (raw !== undefined) {
            variantIndex = Number(raw);
            if (!Number.isInteger(variantIndex) || variantIndex < 0) {
                return reply.status(400).send({ error: 'variant must be a non-negative integer' });
            }
        }

        const image = await postSuggestionsService.getVariantImage(req.workspaceId, pageId, suggestionId, variantIndex);
        // One 404 for every miss — foreign row, no such take, file already
        // swept. Distinguishing them would leak whether a row exists.
        if (!image) return reply.status(404).send({ error: 'Not found' });

        return reply
            .header('Content-Type', image.contentType)
            // `attachment` is what makes this a download rather than a
            // navigation. The filename is server-composed from the row's own
            // date — never from client input, which is how a header-injection
            // or a path-traversal filename gets in.
            .header('Content-Disposition', `attachment; filename="${image.filename}"`)
            // Merchant media behind an auth check: never let a shared cache
            // hold it. `immutable` is safe for the private copy — a card's
            // bytes never change once written; a regenerate mints a new row.
            .header('Cache-Control', 'private, max-age=86400, immutable')
            .send(image.body);
    }

    /** POST /pages/:pageId/post-suggestions/:suggestionId/events — market-signal stamps. */
    async markEvent(
        request: FastifyRequest<{ Params: { pageId: string; suggestionId: string }; Body: { event?: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as ResolvedWorkspaceRequest;
        const { pageId, suggestionId } = request.params;
        if (!isPostSuggestionsEnabledForWorkspace(req.workspaceId)) return reply.status(404).send({ error: 'Not found' });

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
