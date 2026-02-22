import { FastifyReply, FastifyRequest } from 'fastify';
import { pagesService } from '../services/pages';
import { facebookService } from '../services/facebook';
import { subscriptionsService } from '../services/subscriptions';
import { CreatePageDTO, UpdatePageDTO } from '../types';
import type { WorkspaceRequest } from '../middleware/workspace';

export class PagesController {
    /**
     * Create a new page
     * POST /pages
     */
    async create(request: FastifyRequest<{ Body: CreatePageDTO }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = req.user;
        const { workspaceId } = req;

        try {
            // Check enabled page limit before creating (billing stays per-user)
            const limitCheck = await subscriptionsService.canEnablePage(userId, workspaceId);
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

            return reply.status(201).send(page);
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
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const pages = await pagesService.getPages(req.workspaceId);
            return reply.send(pages);
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
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            const page = await pagesService.getPage(req.workspaceId, id);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            return reply.send(page);
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
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            const page = await pagesService.updatePage(req.workspaceId, id, request.body);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            return reply.send(page);
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
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { id } = request.params;

        try {
            // Unsubscribe from webhooks before deleting
            const page = await pagesService.getPage(req.workspaceId, id);
            if (page) {
                await facebookService.unsubscribePageFromWebhooks(page.facebookPageId, page.accessToken);
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
        const req = request as WorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = req.user;
        const { workspaceId } = req;
        const { id } = request.params;
        const { enabled } = request.body;

        try {
            // Only check limit when ENABLING (disabling is always allowed)
            if (enabled) {
                const limitCheck = await subscriptionsService.canEnablePage(userId, workspaceId, id);
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
            return reply.send(page);
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
        const req = request as WorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = req.user;
        const { workspaceId } = req;
        const { accessToken } = request.body;

        if (!accessToken) {
            return reply.status(400).send({
                error: 'Access token is required',
                hint: 'Please log out and log back in to refresh your Facebook token'
            });
        }

        try {
            request.log.info(`[Pages] Sync requested for workspace ${workspaceId}`);
            const { syncedPages, skippedCount } = await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            if (syncedPages.length === 0) {
                return reply.send({
                    synced: 0,
                    pages: [],
                    message: 'No pages found. Make sure you are an admin of at least one Facebook page and have granted the required permissions.'
                });
            }

            const response: Record<string, unknown> = { synced: syncedPages.length, pages: syncedPages };

            if (skippedCount > 0) {
                response.warning = `${skippedCount} page(s) were synced but auto-reply was not enabled due to your plan limit. Upgrade to enable more pages.`;
                response.skippedCount = skippedCount;
            }

            // Include current limit status for frontend display
            const limitCheck = await subscriptionsService.canEnablePage(userId, workspaceId);
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
}

export const pagesController = new PagesController();
