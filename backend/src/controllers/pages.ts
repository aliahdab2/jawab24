import { FastifyReply, FastifyRequest } from 'fastify';
import { pagesService, isPageDisconnected } from '../services/pages';
import { facebookService } from '../services/facebook';
import { subscriptionsService } from '../services/subscriptions';
import { gapDetectorService } from '../services/kb/gap-detector';
import { CreatePageDTO, UpdatePageDTO, createRequestLogger } from '../types';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';
import { config } from '../config';
import { authService } from '../services/auth';
import { BusinessProfileSchema, validateSchema } from '../utils/validation';
import { replyGenerator } from '../services/reply/generator';
import { buildPlaygroundContext } from '../services/reply/playgroundContext';

/** Add isConnected flag and strip accessToken from page response */
function serializePage<T extends { accessToken?: string | null }>(page: T) {
    const { accessToken, ...rest } = page;
    return { ...rest, isConnected: !!accessToken && accessToken !== '' };
}

export class PagesController {
    /**
     * Create a new page
     * POST /pages
     */
    async create(request: FastifyRequest<{ Body: CreatePageDTO }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = req.user;
        const { workspaceId, workspaceOwnerId } = req;

        try {
            // Check enabled page limit — billing is based on workspace owner's subscription
            const limitCheck = await subscriptionsService.canEnablePage(workspaceOwnerId, workspaceId);
            if (!limitCheck.allowed) {
                return reply.status(403).send({
                    error: limitCheck.reason || 'Page limit reached',
                    code: 'PAGE_LIMIT_REACHED',
                    limit: limitCheck.limit,
                    used: limitCheck.used,
                });
            }

            const page = await pagesService.createPage(workspaceId, userId, request.body);

            // Subscribe page to webhook events so Facebook sends comments/messages
            if (request.body.facebookPageId && request.body.accessToken) {
                await facebookService.subscribePageToWebhooks(request.body.facebookPageId, request.body.accessToken);
            }

            return reply.status(201).send(serializePage(page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to create page' });
        }
    }

    /**
     * Get all pages
     * GET /pages
     */
    async getAll(request: FastifyRequest, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const pages = await pagesService.getPages(req.workspaceId);
            return reply.send(pages.map(serializePage));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch pages' });
        }
    }

    /**
     * Get a single page
     * GET /pages/:id
     */
    async getOne(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            const page = await pagesService.getPage(req.workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            return reply.send(serializePage(page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch page' });
        }
    }

    /**
     * Update a page
     * PUT /pages/:id
     */
    async update(request: FastifyRequest<{ Params: { id: string }; Body: UpdatePageDTO }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            // Validate businessProfile if present
            if (request.body.businessProfile !== undefined) {
                const validation = validateSchema(BusinessProfileSchema, request.body.businessProfile);
                if (!validation.success) {
                    return reply.status(400).send({ error: 'Invalid business profile', errors: validation.errors });
                }
                request.body.businessProfile = validation.data;
            }

            const page = await pagesService.updatePage(req.workspaceId, id, request.body);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            return reply.send(serializePage(page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update page' });
        }
    }

    /**
     * Delete a page
     * DELETE /pages/:id
     */
    async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            // Unsubscribe from webhooks before deleting
            const page = await pagesService.getPage(req.workspaceId, id);
            if (page) {
                if (page.facebookPageId) {
                    await facebookService.unsubscribePageFromWebhooks(page.facebookPageId, page.accessToken);
                }
            }

            await pagesService.deletePage(req.workspaceId, id);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete page' });
        }
    }

    /**
     * Toggle auto-reply for a page
     * PATCH /pages/:id/auto-reply
     */
    async toggleAutoReply(request: FastifyRequest<{ Params: { id: string }; Body: { enabled: boolean } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { workspaceId, workspaceOwnerId } = req;
        const { id } = request.params;
        const { enabled } = request.body;

        try {
            // Only check limit when ENABLING (disabling is always allowed)
            if (enabled) {
                // Block enabling if page access was revoked in Facebook
                const existingPage = await pagesService.getPage(workspaceId, id);
                if (isPageDisconnected(existingPage)) {
                    return reply.status(400).send({
                        error: 'This page is disconnected. Please reconnect via Facebook to resume auto-replies.',
                        code: 'PAGE_DISCONNECTED',
                    });
                }

                const limitCheck = await subscriptionsService.canEnablePage(workspaceOwnerId, workspaceId, id);
                if (!limitCheck.allowed) {
                    return reply.status(403).send({
                        error: limitCheck.reason || 'Page limit reached',
                        code: 'PAGE_LIMIT_REACHED',
                        limit: limitCheck.limit,
                        used: limitCheck.used,
                    });
                }
            }

            const page = await pagesService.toggleAutoReply(workspaceId, id, enabled);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            return reply.send(serializePage(page));
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to toggle auto-reply' });
        }
    }

    /**
     * Sync pages from Facebook
     * POST /pages/sync
     */
    async sync(request: FastifyRequest<{ Body: { accessToken: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = req.user;
        const { workspaceId, workspaceOwnerId } = req;
        const { accessToken } = request.body;

        if (!accessToken) {
            return reply.status(400).send({
                error: 'Access token is required',
                hint: 'Please log out and log back in to refresh your Facebook token'
            });
        }

        // Demo users have no real Facebook token — return their seeded pages directly
        const dbUser = config.demo.enabled ? await authService.getUserById(userId) : null;
        if (dbUser?.facebookId === config.demo.userFacebookId) {
            const pages = await pagesService.getPages(workspaceId);
            return reply.send({ synced: pages.length, pages: pages.map(serializePage), skipped: 0 });
        }

        try {
            request.log.info(`[Pages] Sync requested for workspace ${workspaceId}`);
            const { syncedPages, skippedCount, takenCount, revokedCount, alreadyMemberOf } = await pagesService.syncFromFacebook(workspaceId, userId, accessToken, workspaceOwnerId, createRequestLogger(request.log));

            if (syncedPages.length === 0 && takenCount === 0) {
                return reply.send({
                    synced: 0,
                    pages: [],
                    message: 'No pages found. Make sure you are an admin of at least one Facebook page and have granted the required permissions.'
                });
            }

            const response: Record<string, unknown> = { synced: syncedPages.length, pages: syncedPages.map(serializePage) };

            if (skippedCount > 0) {
                response.warning = `${skippedCount} page(s) were synced but auto-reply was not enabled due to your plan limit. Upgrade to enable more pages.`;
                response.skippedCount = skippedCount;
            }

            if (takenCount > 0) {
                response.takenCount = takenCount;
            }

            // Pages whose holding workspace the user is already a member of — the
            // client renders an actionable "Switch to ‹X›" affordance instead of
            // the generic "ask the owner to invite you" warning.
            if (alreadyMemberOf && alreadyMemberOf.length > 0) {
                response.alreadyMemberOf = alreadyMemberOf;
            }

            if ((revokedCount ?? 0) > 0) {
                response.revokedWarning = `${revokedCount} page(s) were disconnected because access was revoked in Facebook.`;
                response.revokedCount = revokedCount;
            }

            // Include current limit status for frontend display
            const limitCheck = await subscriptionsService.canEnablePage(workspaceOwnerId, workspaceId);
            if (limitCheck.remaining !== undefined) {
                response.enabledPagesRemaining = limitCheck.remaining;
            }

            return reply.send(response);
        } catch (error) {
            request.log.error(error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return reply.status(500).send({
                error: 'Failed to sync pages from Facebook',
                details: errorMessage,
                hint: 'This could be due to an expired token. Try logging out and back in.'
            });
        }
    }
    /**
     * Get unresolved KB gaps for a page
     * GET /pages/:id/kb-gaps
     */
    async getKbGaps(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            // Verify page belongs to this workspace
            const page = await pagesService.getPage(req.workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            const gaps = await gapDetectorService.getUnresolvedGaps(id, 10);
            return reply.send({ success: true, data: gaps });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch KB gaps' });
        }
    }

    /**
     * Dismiss (resolve) a KB gap
     * POST /pages/:id/kb-gaps/:gapId/dismiss
     */
    async dismissGap(request: FastifyRequest<{ Params: { id: string; gapId: string } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id, gapId } = request.params;

        try {
            const page = await pagesService.getPage(req.workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            await gapDetectorService.resolveGap(gapId, id);
            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to dismiss KB gap' });
        }
    }

    /**
     * Test smart reply generation for a page
     * POST /pages/:id/test-reply
     */
    async testReply(request: FastifyRequest<{ Params: { id: string }; Body: { question: string; channel: 'comment' | 'dm'; postMessage?: string; conversationHistory?: { role: 'user' | 'assistant'; content: string }[] } }>, reply: FastifyReply) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { workspaceOwnerId } = req;
        const { id } = request.params;
        const { question, channel, postMessage, conversationHistory } = request.body;
        const startTime = Date.now();

        // 1. Validate input
        if (!question?.trim()) {
            return reply.status(400).send({ error: 'question is required' });
        }
        if (question.length > 500) {
            return reply.status(400).send({ error: 'question must be 500 characters or less' });
        }
        if (channel !== 'comment' && channel !== 'dm') {
            return reply.status(400).send({ error: 'channel must be "comment" or "dm"' });
        }
        if (postMessage && postMessage.length > 1000) {
            return reply.status(400).send({ error: 'postMessage must be 1000 characters or less' });
        }
        if (conversationHistory && !Array.isArray(conversationHistory)) {
            return reply.status(400).send({ error: 'conversationHistory must be an array' });
        }
        if (conversationHistory && conversationHistory.length > 20) {
            return reply.status(400).send({ error: 'conversationHistory must be 20 messages or less' });
        }

        // 2. Check AI quota
        const quotaCheck = await subscriptionsService.canUseAiReplies(workspaceOwnerId);
        if (!quotaCheck.allowed) {
            return reply.status(403).send({
                error: quotaCheck.reason || 'AI reply limit reached',
                code: 'AI_QUOTA_EXCEEDED',
                limit: quotaCheck.limit,
                used: quotaCheck.used,
            });
        }

        try {
            // 3. Fetch page (workspace-scoped — tenant isolation)
            const page = await pagesService.getPage(req.workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            // 4–6. Build playground context (shared with admin playground)
            const { playgroundInput, commentReplyMode, nudgeText } = await buildPlaygroundContext({
                page, question, channel, postMessage,
                conversationHistory: channel === 'dm' ? conversationHistory : undefined,
            });

            // 7. Generate reply via the same pipeline as production
            replyGenerator.setLogger(request.log);
            const result = await replyGenerator.generateForPlayground(playgroundInput);

            // 8. Strip internal metadata — return only customer-safe fields.
            // When the generator returned 'skipped' (friend-tag, spam, punctuation w/o post
            // context), production posts NOTHING — not the full reply, not the nudge. Match
            // that here: nudgeText is null on skipped so the UI doesn't show a phantom nudge.
            const isSkipped = result.replyMethod === 'skipped';
            return reply.send({
                success: true,
                data: {
                    reply: result.reply,
                    replyMethod: result.replyMethod,
                    latencyMs: Date.now() - startTime,
                    commentReplyMode: channel === 'comment' ? commentReplyMode : null,
                    nudgeText: channel === 'comment' && !isSkipped ? nudgeText : null,
                },
            });
        } catch (error) {
            request.log.error(error, 'Test smart reply failed');
            return reply.status(500).send({ error: 'Failed to generate reply' });
        }
    }
}

export const pagesController = new PagesController();
