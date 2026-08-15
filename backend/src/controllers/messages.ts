import { FastifyReply, FastifyRequest } from 'fastify';
import { messagesService } from '../services/messages';
import { conversationsService } from '../services/conversations';
import { pagesService, isPageDisconnected } from '../services/pages';
import { invalidateEndpointStatsCaches } from '../services/statsCache';
import { facebookService } from '../services/facebook';
import { instagramService } from '../services/instagram';
import { resolveInstagramCredential } from '../services/instagramCredential';
import { whatsappService, META_TOKEN_EXPIRED } from '../services/whatsapp';
import { workspaceSettingsService } from '../services/workspaceSettings';
import { promoteDelayedJobs } from '../lib/replyQueue';
import { parseInboxFilters, parseLimit } from '../lib/queryParsers';
import type { WorkspaceRequest } from '../middleware/workspace';
import { DmSendError, classifyDmError, type FbPlatform } from '../utils/fbGraphErrors';
import { AppError } from '../utils/errors';

type DmPlatform = FbPlatform | 'whatsapp';

/** Resolve the three-way DM platform from a message/conversation row. */
function resolveDmPlatform(platform: string | null | undefined): DmPlatform {
    if (platform === 'instagram') return 'instagram';
    if (platform === 'whatsapp') return 'whatsapp';
    return 'facebook';
}

/** Meta error code: outside the 24h customer-service window (re-engagement needed). */
const META_WA_WINDOW_EXPIRED = 131047;

/** Map a WhatsApp send failure to an AppError. whatsappService throws a
 *  sanitized WhatsAppApiError (metaCode + message, no secrets); fall back to the
 *  raw axios shape for safety. */
function mapWhatsAppSendError(error: unknown): AppError {
    const e = error as { metaCode?: number; message?: string; response?: { data?: { error?: { code?: number; message?: string } } } };
    const code = e.metaCode ?? e.response?.data?.error?.code;
    if (code === META_WA_WINDOW_EXPIRED) {
        return new AppError(
            'More than 24 hours have passed since the customer\'s last message — WhatsApp only allows template messages now.',
            409,
            'DM_WINDOW_EXPIRED'
        );
    }
    // Meta forces a 60-day expiry on WhatsApp Embedded Signup tokens, so 190 is an
    // expected end-of-life event, not a fault. 409 (not 502) keeps it out of Sentry's
    // 5xx bucket for the same reason DM_PLATFORM_AUTH does on FB/IG: the merchant has
    // to reconnect, there is nothing for us to fix. Without this branch it fell into
    // DM_UNKNOWN and surfaced as a raw Meta string.
    if (code === META_TOKEN_EXPIRED) {
        return new AppError(
            'Your WhatsApp connection has expired. Reconnect WhatsApp to keep replying.',
            409,
            'WHATSAPP_TOKEN_EXPIRED'
        );
    }
    const detail = e.message || e.response?.data?.error?.message || 'Failed to send WhatsApp message';
    return new AppError(detail, 502, 'DM_UNKNOWN', false);
}

// Map a classified DM-send failure to an AppError with a proper status code.
// 4xx for expected conditions (won't flood Sentry); 5xx for real faults on our side.
function mapDmErrorToAppError(error: DmSendError, platform: FbPlatform): AppError {
    const classified = classifyDmError(error, platform);
    const detail = classified.fbMessage || error.message;
    switch (classified.bucket) {
        case 'window_expired':
            return new AppError(detail, 409, 'DM_WINDOW_EXPIRED');
        case 'customer_refused':
            return new AppError(detail, 409, 'DM_CUSTOMER_UNAVAILABLE');
        case 'transient':
            return new AppError(detail, 503, 'DM_TRANSIENT');
        case 'our_fault':
            // Merchant-action-required (token expired/revoked, missing permission).
            // 409 keeps these out of Sentry's 5xx error bucket — merchants need to reconnect,
            // not the engineering team to fix code.
            return new AppError(detail, 409, 'DM_PLATFORM_AUTH');
        case 'thread_owned_elsewhere':
            // Another app owns this conversation via Meta's Handover Protocol
            // (Graph 100/2534037) — the merchant must disconnect the competing
            // tool; there is nothing for engineering to fix, so 409 like the
            // other merchant-action buckets, never a Sentry-visible 502.
            return new AppError(detail, 409, 'DM_THREAD_OWNED');
        default:
            return new AppError(detail, 502, 'DM_UNKNOWN', false);
    }
}

/**
 * Send a manual DM via FB/IG and persist the outgoing row. Shared by /messages/:id/reply
 * and /messages/conversation/:senderId/reply. Both paths need identical:
 *   - empty-token disconnect check (409 keeps Sentry quiet vs FB errors)
 *   - FB/IG branching by platform
 *   - DmSendError → AppError mapping
 *   - storeOutgoingMessage with the merchant's idempotency key
 *
 * Callers are responsible for tenant verification, idempotency dedupe lookup, and
 * any extra steps unique to their flow (e.g., markAsReplied on the incoming row).
 */
async function sendAndStoreManualReply(opts: {
    workspaceId: string;
    page: { accessToken: string; instagramAccountId: string | null; whatsappPhoneNumberId?: string | null; whatsappAccessToken?: string | null };
    platform: DmPlatform;
    pageId: string;
    recipientId: string;
    replyText: string;
    clientMessageId?: string;
}) {
    const { workspaceId, page, platform, pageId, recipientId, replyText, clientMessageId } = opts;

    // Disconnect guard is per-channel: WhatsApp sends authenticate with the WABA
    // token, so a blanked Facebook token (or a WhatsApp-only page, where it is
    // always '') must not block them — and vice versa.
    let waPhoneNumberId = '';
    let waAccessToken = '';
    if (platform === 'whatsapp') {
        if (!page.whatsappPhoneNumberId || !page.whatsappAccessToken) {
            throw new AppError(
                'WhatsApp is disconnected for this page. Please reconnect the number to resume replies.',
                409,
                'WHATSAPP_DISCONNECTED'
            );
        }
        waPhoneNumberId = page.whatsappPhoneNumberId;
        waAccessToken = page.whatsappAccessToken;
    } else if (isPageDisconnected(page)) {
        // Empty accessToken is the disconnect sentinel set by pages sync / tokenRefresh
        // when FB revokes the page. Merchant must reconnect.
        throw new AppError(
            'This page is disconnected. Please reconnect via Facebook to resume replies.',
            409,
            'PAGE_DISCONNECTED'
        );
    }

    // Platform's own id for this send (WhatsApp wamid). Persisted below so a
    // Coexistence echo of this message is recognised as ours — the merchant sent it
    // from OUR inbox, and Meta will echo it back exactly like a phone-sent one.
    let sentPlatformMessageId: string | undefined;

    try {
        if (platform === 'whatsapp') {
            sentPlatformMessageId = await whatsappService.sendTextMessage(
                waPhoneNumberId,
                recipientId,
                replyText,
                waAccessToken
            ) || undefined;
        } else if (platform === 'instagram' && page.instagramAccountId) {
            await instagramService.sendDirectMessage(
                page.instagramAccountId,
                recipientId,
                replyText,
                resolveInstagramCredential(page)
            );
        } else {
            await facebookService.sendPrivateMessage(
                page.accessToken,
                recipientId,
                replyText
            );
        }
    } catch (error) {
        if (platform === 'whatsapp') {
            throw mapWhatsAppSendError(error);
        }
        if (error instanceof DmSendError) {
            throw mapDmErrorToAppError(error, platform);
        }
        throw error;
    }

    return messagesService.storeOutgoingMessage(
        pageId,
        workspaceId,
        recipientId,
        replyText,
        'manual',
        undefined,
        undefined,
        undefined,
        clientMessageId,
        undefined,
        sentPlatformMessageId,
    );
}

export class MessagesController {
    /**
     * Get all messages with pagination
     * GET /messages
     */
    async getAll(request: FastifyRequest<{
        Querystring: {
            cursor?: string;
            limit?: string;
            direction?: 'incoming' | 'outgoing';
            replied?: string;
            resolved?: string;
            needsAttention?: string;
            actionRequired?: string;
            pageId?: string;
        }
    }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const { cursor, limit, direction, replied, resolved, needsAttention, actionRequired, pageId } = request.query;

            const options = {
                ...(cursor && { cursor }),
                ...(limit !== undefined && { limit: parseLimit(limit) }),
                ...(direction && ['incoming', 'outgoing'].includes(direction) && { direction }),
                ...(pageId && { pageId }),
                ...parseInboxFilters({ replied, resolved, needsAttention, actionRequired }),
            };

            const result = await messagesService.getMessages(req.workspaceId, options);
            return reply.send(result);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error getting messages');
            return reply.status(500).send({ error: 'Failed to get messages' });
        }
    }

    /**
     * Get message statistics for the current workspace.
     *
     * GET /messages/stats
     *
     * Query params:
     * - pageId (optional, UUID): Scope counts to a single page so the chip badges
     *   on the messages page match the filtered list. Omit for workspace-wide totals.
     */
    async getStats(
        request: FastifyRequest<{ Querystring: { pageId?: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const { pageId } = request.query;

        try {
            const stats = await messagesService.getStats(req.workspaceId, pageId ? { pageId } : undefined);
            return reply.send(stats);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error getting message stats');
            return reply.status(500).send({ error: 'Failed to get message stats' });
        }
    }

    /**
     * Locate a message by id — returns { senderId, pageId } so deep-link handlers
     * can open the containing conversation without scanning the paginated list.
     * GET /messages/locate/:messageId
     */
    async locateMessage(
        request: FastifyRequest<{ Params: { messageId: string } }>,
        reply: FastifyReply
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const { messageId } = request.params;
            const message = await messagesService.getMessageById(messageId);
            if (!message) {
                return reply.status(404).send({ error: 'Message not found' });
            }

            const page = await pagesService.getPage(req.workspaceId, message.pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Unauthorized: page not owned by workspace' });
            }

            return reply.send({ senderId: message.senderId, pageId: message.pageId });
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error locating message');
            return reply.status(500).send({ error: 'Failed to locate message' });
        }
    }

    /**
     * Get conversation with a specific sender
     * GET /messages/conversation/:senderId
     */
    async getConversation(
        request: FastifyRequest<{ Params: { senderId: string }; Querystring: { pageId?: string; limit?: string } }>,
        reply: FastifyReply
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const { senderId } = request.params;
            const { pageId, limit: limitStr } = request.query;
            const limit = limitStr ? parseInt(limitStr) : 50;

            if (!pageId) {
                return reply.status(400).send({ error: 'pageId is required' });
            }

            // Verify workspace owns the page before returning its messages
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Unauthorized: page not owned by workspace' });
            }

            const messages = await messagesService.getConversation(pageId, senderId, limit);
            return reply.send(messages);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error getting conversation');
            return reply.status(500).send({ error: 'Failed to get conversation' });
        }
    }
    /**
     * Reply to a message manually
     * POST /messages/:id/reply
     */
    async reply(
        request: FastifyRequest<{ Params: { id: string }; Body: { replyText: string; clientMessageId?: string } }>,
        reply: FastifyReply
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;
        const { replyText, clientMessageId } = request.body;

        if (!replyText || replyText.trim().length === 0) {
            return reply.status(400).send({ error: 'Reply text is required' });
        }

        // Reject obviously malformed idempotency keys early — anything we accept gets persisted
        // under a UNIQUE index. UUIDs comfortably fit; reject the rest rather than risk a
        // 23505 surfacing as a 500.
        if (clientMessageId !== undefined && (typeof clientMessageId !== 'string' || clientMessageId.length === 0 || clientMessageId.length > 64)) {
            return reply.status(400).send({ error: 'Invalid clientMessageId' });
        }

        // 1. Find the original incoming message
        const message = await messagesService.getMessageById(id);
        if (!message) {
            return reply.status(404).send({ error: 'Message not found' });
        }

        // 2. Verify workspace owns the page
        const page = await pagesService.getPage(req.workspaceId, message.pageId);
        if (!page) {
            return reply.status(403).send({ error: 'Unauthorized: page not owned by workspace' });
        }

        // 2b. Idempotency dedupe — if the client retried after a network blip and we already
        // delivered the previous attempt, return the stored outgoing row instead of re-hitting
        // the FB/IG Graph API. Bad-network clients (e.g. Syria) commonly time out reading the
        // success response even though the send completed server-side.
        if (clientMessageId) {
            const existing = await messagesService.findOutgoingByClientMessageId(message.pageId, clientMessageId);
            if (existing) {
                return reply.send(existing);
            }
        }

        // 3. Send via FB/IG/WhatsApp (with classified error mapping) and store the outgoing row.
        const trimmed = replyText.trim();
        const platform = resolveDmPlatform(message.platform);
        const outgoing = await sendAndStoreManualReply({
            workspaceId: req.workspaceId,
            page,
            platform,
            pageId: message.pageId,
            recipientId: message.senderId,
            replyText: trimmed,
            clientMessageId,
        });

        // 4. Mark the original message as replied (manual). Only this path has an
        // incoming row to mark — the conversation-level send skips this step.
        await messagesService.markAsReplied(message.id, trimmed, 'manual');
        // User-initiated mutation — the UI refetches stats right away, so drop
        // the cached aggregation now (unthrottled, unlike the pipeline path).
        invalidateEndpointStatsCaches(req.workspaceId);

        return reply.send(outgoing);
        // Unexpected errors propagate to the global errorHandler, which reports them to Sentry.
    }

    /**
     * Send a manual DM into an existing conversation without targeting a specific
     * incoming message. Used when the customer never sent a DM (e.g., dual-mode comment
     * reply) so /messages/:id/reply has no message id to anchor on. Tenant safety: a
     * conversations row must already exist for (pageId, senderId), proving prior contact.
     * POST /messages/conversation/:senderId/reply
     */
    async replyToConversation(
        request: FastifyRequest<{
            Params: { senderId: string };
            Body: { pageId: string; replyText: string; clientMessageId?: string };
        }>,
        reply: FastifyReply
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { senderId } = request.params;
        const { pageId, replyText, clientMessageId } = request.body;

        if (!pageId) {
            return reply.status(400).send({ error: 'pageId is required' });
        }
        if (!replyText || replyText.trim().length === 0) {
            return reply.status(400).send({ error: 'Reply text is required' });
        }
        if (clientMessageId !== undefined && (typeof clientMessageId !== 'string' || clientMessageId.length === 0 || clientMessageId.length > 64)) {
            return reply.status(400).send({ error: 'Invalid clientMessageId' });
        }

        // 1. Verify workspace owns the page
        const page = await pagesService.getPage(req.workspaceId, pageId);
        if (!page) {
            return reply.status(403).send({ error: 'Unauthorized: page not owned by workspace' });
        }

        // 2. Tenant safety — require an existing conversation on this page.
        // Without this guard, the endpoint could send DMs to arbitrary FB users using a
        // page the merchant happens to own. The conversation row proves prior contact
        // (either the customer messaged us, or we DM'd them via a dual-mode comment reply).
        const conversation = await conversationsService.findByPageAndSender(pageId, senderId);
        if (!conversation) {
            throw new AppError(
                'No conversation exists for this recipient on this page.',
                404,
                'CONVERSATION_NOT_FOUND'
            );
        }

        // 3. Idempotency dedupe — same contract as /messages/:id/reply.
        if (clientMessageId) {
            const existing = await messagesService.findOutgoingByClientMessageId(pageId, clientMessageId);
            if (existing) {
                return reply.send(existing);
            }
        }

        // 4. Send via FB/IG/WhatsApp (with classified error mapping) and store the outgoing row.
        // Platform comes from the conversation row, not a message. No markAsReplied —
        // there is no incoming row to mark.
        const platform = resolveDmPlatform(conversation.platform);
        const outgoing = await sendAndStoreManualReply({
            workspaceId: req.workspaceId,
            page,
            platform,
            pageId,
            recipientId: senderId,
            replyText: replyText.trim(),
            clientMessageId,
        });

        return reply.send(outgoing);
    }

    /**
     * Pause auto-reply for a specific conversation
     * POST /messages/conversation/:senderId/pause
     */
    async pauseConversation(
        request: FastifyRequest<{
            Params: { senderId: string };
            Body: { pageId: string; durationMinutes?: number };
        }>,
        reply: FastifyReply
    ) {
        const req = request as WorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const { senderId } = request.params;
            const { pageId, durationMinutes } = request.body;

            if (!pageId) {
                return reply.status(400).send({ error: 'pageId is required' });
            }

            // Verify workspace owns the page
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Unauthorized: page not owned by workspace' });
            }

            // Use provided duration or user's default from settings
            let duration = durationMinutes;
            if (!duration) {
                const wsSettings = await workspaceSettingsService.getSettings(req.workspaceId);
                duration = wsSettings.handoffPauseDurationMinutes;
            }

            const result = await messagesService.pauseConversation(pageId, senderId, duration);
            return reply.send({ success: true, pausedUntil: result.pausedUntil });
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error pausing conversation');
            return reply.status(500).send({ error: 'Failed to pause conversation' });
        }
    }

    /**
     * Resume auto-reply for a specific conversation
     * POST /messages/conversation/:senderId/resume
     */
    async resumeConversation(
        request: FastifyRequest<{
            Params: { senderId: string };
            Body: { pageId: string };
        }>,
        reply: FastifyReply
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const { senderId } = request.params;
            const { pageId } = request.body;

            if (!pageId) {
                return reply.status(400).send({ error: 'pageId is required' });
            }

            // Verify workspace owns the page
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Unauthorized: page not owned by workspace' });
            }

            // Pass the workspace's handoff window so the resume marker TTL
            // matches it — otherwise a non-default window would let the
            // implicit pause linger past the marker.
            const wsSettings = await workspaceSettingsService.getSettings(req.workspaceId);
            await messagesService.resumeConversation(pageId, senderId, wsSettings.handoffPauseDurationMinutes);

            // Promote any delayed handoff jobs so they process immediately
            let promoted = 0;
            try {
                promoted = await promoteDelayedJobs(page.id, senderId);
            } catch (err) {
                // Non-critical: resume succeeded, jobs will process when their delay expires
                request.log.warn({ error: String(err), pageId, senderId }, 'Failed to promote delayed jobs on resume');
            }
            return reply.send({ success: true, promotedJobs: promoted });
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error resuming conversation');
            return reply.status(500).send({ error: 'Failed to resume conversation' });
        }
    }

    /**
     * Get pause status for a specific conversation
     * GET /messages/conversation/:senderId/pause-status
     */
    async getPauseStatus(
        request: FastifyRequest<{
            Params: { senderId: string };
            Querystring: { pageId?: string };
        }>,
        reply: FastifyReply
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const { senderId } = request.params;
            const { pageId } = request.query;

            if (!pageId) {
                return reply.status(400).send({ error: 'pageId is required' });
            }

            // Verify workspace owns the page
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Unauthorized: page not owned by workspace' });
            }

            // Use the merchant's configured handoff window so the manual-reply
            // detection + auto-resume countdown match the reply pipeline (which
            // gates on the same setting). Passing the default here would mis-report
            // the pause for any merchant who changed the duration.
            const wsSettings = await workspaceSettingsService.getSettings(req.workspaceId);
            const status = await messagesService.getPauseStatus(pageId, senderId, wsSettings.handoffPauseDurationMinutes);
            return reply.send(status);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error getting pause status');
            return reply.status(500).send({ error: 'Failed to get pause status' });
        }
    }
    /**
     * Resolve all unreplied messages in a conversation
     * POST /messages/conversation/:senderId/resolve
     */
    async resolveConversation(
        request: FastifyRequest<{
            Params: { senderId: string };
            Body: { pageId: string };
        }>,
        reply: FastifyReply
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const { senderId } = request.params;
            const { pageId } = request.body;

            if (!pageId) {
                return reply.status(400).send({ error: 'pageId is required' });
            }

            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Unauthorized: page not owned by workspace' });
            }

            const count = await messagesService.resolveConversation(pageId, senderId);
            invalidateEndpointStatsCaches(req.workspaceId);
            return reply.send({ success: true, resolved: count });
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error resolving conversation');
            return reply.status(500).send({ error: 'Failed to resolve conversation' });
        }
    }

    /**
     * Unresolve messages in a conversation
     * POST /messages/conversation/:senderId/unresolve
     */
    async unresolveConversation(
        request: FastifyRequest<{
            Params: { senderId: string };
            Body: { pageId: string };
        }>,
        reply: FastifyReply
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const { senderId } = request.params;
            const { pageId } = request.body;

            if (!pageId) {
                return reply.status(400).send({ error: 'pageId is required' });
            }

            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Unauthorized: page not owned by workspace' });
            }

            const count = await messagesService.unresolveConversation(pageId, senderId);
            invalidateEndpointStatsCaches(req.workspaceId);
            return reply.send({ success: true, unresolved: count });
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error unresolving conversation');
            return reply.status(500).send({ error: 'Failed to unresolve conversation' });
        }
    }
}

export const messagesController = new MessagesController();
