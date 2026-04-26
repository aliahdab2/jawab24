import { FastifyReply, FastifyRequest } from 'fastify';
import { messagesService } from '../services/messages';
import { pagesService } from '../services/pages';
import { facebookService } from '../services/facebook';
import { instagramService } from '../services/instagram';
import { workspaceSettingsService } from '../services/workspaceSettings';
import { promoteDelayedJobs } from '../lib/replyQueue';
import { parseInboxFilters, parseLimit } from '../lib/queryParsers';
import type { WorkspaceRequest } from '../middleware/workspace';
import { DmSendError, classifyDmError, type FbPlatform } from '../utils/fbGraphErrors';
import { AppError } from '../utils/errors';

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
        default:
            return new AppError(detail, 502, 'DM_UNKNOWN', false);
    }
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
     * Get message statistics
     * GET /messages/stats
     */
    async getStats(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const stats = await messagesService.getStats(req.workspaceId);
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
        request: FastifyRequest<{ Params: { id: string }; Body: { replyText: string } }>,
        reply: FastifyReply
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;
        const { replyText } = request.body;

        if (!replyText || replyText.trim().length === 0) {
            return reply.status(400).send({ error: 'Reply text is required' });
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

        // 3. Send the reply via the appropriate platform API.
        // Classify Graph API errors so expected conditions (window expired, customer blocked,
        // rate limits) return proper 4xx/5xx codes rather than generic 500s that flood Sentry.
        const platform: FbPlatform = message.platform === 'instagram' ? 'instagram' : 'facebook';
        // Empty token in DB is our bug (column is notNull, so this means we wrote ""
        // somewhere — sync failure, decrypt failure, etc.). Distinct from FB-rejected
        // tokens which are merchant-action-required. Use a separate code so this still
        // surfaces in Sentry while DM_PLATFORM_AUTH stays out.
        if (!page.accessToken || page.accessToken.trim().length === 0) {
            throw new AppError('Page access token missing in database', 500, 'DM_TOKEN_MISSING');
        }
        try {
            if (platform === 'instagram' && page.instagramAccountId) {
                await instagramService.sendDirectMessage(
                    page.instagramAccountId,
                    message.senderId,
                    replyText.trim(),
                    page.accessToken
                );
            } else {
                await facebookService.sendPrivateMessage(
                    page.accessToken,
                    message.senderId,
                    replyText.trim()
                );
            }
        } catch (error) {
            if (error instanceof DmSendError) {
                throw mapDmErrorToAppError(error, platform);
            }
            throw error;
        }

        // 4. Mark the original message as replied (manual)
        await messagesService.markAsReplied(message.id, replyText.trim(), 'manual');

        // 5. Store the outgoing message
        const outgoing = await messagesService.storeOutgoingMessage(
            message.pageId,
            req.workspaceId,
            message.senderId,
            replyText.trim(),
            'manual'
        );

        return reply.send(outgoing);
        // Unexpected errors propagate to the global errorHandler, which reports them to Sentry.
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

            await messagesService.resumeConversation(pageId, senderId);

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

            const status = await messagesService.getPauseStatus(pageId, senderId);
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
            return reply.send({ success: true, unresolved: count });
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error unresolving conversation');
            return reply.status(500).send({ error: 'Failed to unresolve conversation' });
        }
    }
}

export const messagesController = new MessagesController();
