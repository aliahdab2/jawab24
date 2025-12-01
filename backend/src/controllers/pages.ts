import { FastifyReply, FastifyRequest } from 'fastify';
import { pagesService } from '../services/pages';
import { CreatePageDTO, UpdatePageDTO } from '../types';
import { AuthenticatedRequest } from '../middleware/auth';

export class PagesController {
    /**
     * Create a new page
     * POST /pages
     */
    async create(request: FastifyRequest<{ Body: CreatePageDTO }>, reply: FastifyReply) {
        const { userId } = (request as AuthenticatedRequest).user!;
        
        try {
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
        const { userId } = (request as AuthenticatedRequest).user!;
        
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
        const { userId } = (request as AuthenticatedRequest).user!;
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
        const { userId } = (request as AuthenticatedRequest).user!;
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
        const { userId } = (request as AuthenticatedRequest).user!;
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
        const { userId } = (request as AuthenticatedRequest).user!;
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
        const { userId } = (request as AuthenticatedRequest).user!;
        const { accessToken } = request.body;
        
        if (!accessToken) {
            return reply.status(400).send({ 
                error: 'Access token is required',
                hint: 'Please log out and log back in to refresh your Facebook token'
            });
        }

        try {
            request.log.info(`[Pages] Sync requested for user ${userId}`);
            const pages = await pagesService.syncFromFacebook(userId, accessToken);
            
            if (pages.length === 0) {
                return reply.send({ 
                    synced: 0, 
                    pages: [],
                    message: 'No pages found. Make sure you are an admin of at least one Facebook page and have granted the required permissions.'
                });
            }
            
            return reply.send({ synced: pages.length, pages });
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

