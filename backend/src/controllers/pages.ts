import { FastifyReply, FastifyRequest } from 'fastify';
import { pagesService } from '../services/pages';
import { subscriptionsService } from '../services/subscriptions';
import { CreatePageDTO, UpdatePageDTO } from '../types';
import { AuthenticatedRequest } from '../middleware/auth';

export class PagesController {
    /**
     * Create a new page
     * POST /pages
     */
    async create(request: FastifyRequest<{ Body: CreatePageDTO }>, reply: FastifyReply) {
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        
        try {
            // Check page limit before creating
            const limitCheck = await subscriptionsService.canAddPage(userId);
            if (!limitCheck.allowed) {
                return reply.status(403).send({ 
                    error: limitCheck.reason || 'Page limit reached',
                    limit: limitCheck.limit,
                    used: limitCheck.used,
                });
            }
            
            const page = await pagesService.createPage(userId, request.body);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        
        try {
            const pages = await pagesService.getPages(userId);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { id } = request.params;
        
        try {
            const page = await pagesService.getPage(userId, id);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { id } = request.params;
        
        try {
            const page = await pagesService.updatePage(userId, id, request.body);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { id } = request.params;
        
        try {
            await pagesService.deletePage(userId, id);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { id } = request.params;
        const { enabled } = request.body;
        
        try {
            const page = await pagesService.toggleAutoReply(userId, id, enabled);
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { accessToken } = request.body;
        
        if (!accessToken) {
            return reply.status(400).send({ 
                error: 'Access token is required',
                hint: 'Please log out and log back in to refresh your Facebook token'
            });
        }

        try {
            // Check page limit before syncing
            const limitCheck = await subscriptionsService.canAddPage(userId);
            
            request.log.info(`[Pages] Sync requested for user ${userId}`);
            const pages = await pagesService.syncFromFacebook(userId, accessToken);
            
            if (pages.length === 0) {
                return reply.send({ 
                    synced: 0, 
                    pages: [],
                    message: 'No pages found. Make sure you are an admin of at least one Facebook page and have granted the required permissions.'
                });
            }
            
            // Warn if user is at or near their limit
            const response: Record<string, unknown> = { synced: pages.length, pages };
            if (!limitCheck.allowed) {
                response.warning = `You have reached your page limit (${limitCheck.limit}). Some pages may not be synced. Upgrade to add more pages.`;
            } else if (limitCheck.remaining !== null && limitCheck.remaining !== undefined && limitCheck.remaining <= 1) {
                response.warning = `You can add ${limitCheck.remaining} more page(s). Consider upgrading for more pages.`;
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

