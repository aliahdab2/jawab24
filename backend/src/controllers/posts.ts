import { FastifyReply, FastifyRequest } from 'fastify';
import { POST_REPLY_IMAGE_MAX_BYTES, POST_REPLY_IMAGE_MIME_TYPES } from '@jawab24/shared';
import { postsService, type TriggerImageInput } from '../services/posts';
import { pagesService } from '../services/pages';
import { validatePostReplyRuleInput } from '../services/reply/postReplyRule';
import { imageStorage } from '../services/imageStorage';
import { bufferMatchesMime } from '../services/kb/file-extractor';
import { UpdatePostDTO } from '../types';
import type { WorkspaceRequest } from '../middleware/workspace';

export class PostsController {
    /**
     * Get all posts for workspace
     * GET /posts
     */
    async getAll(request: FastifyRequest, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const posts = await postsService.getPostsByWorkspace(req.workspaceId);
            return reply.send(posts);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch posts' });
        }
    }

    /**
     * Get posts for a specific page
     * GET /pages/:pageId/posts
     */
    async getByPage(request: FastifyRequest<{ Params: { pageId: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { pageId } = request.params;

        try {
            // Verify workspace owns the page
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            const posts = await postsService.getPostsByPage(pageId);
            return reply.send(posts);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch posts' });
        }
    }

    /**
     * List the page's recent published posts for the Post Reply picker, merged with
     * their stored trigger state. Per-platform (a page with both FB + IG shows a
     * source toggle in the picker). Newest first; `after` pages via the Graph cursor.
     * GET /pages/:pageId/published-posts?source=facebook|instagram&after=<cursor>
     */
    async getPublishedPosts(
        request: FastifyRequest<{ Params: { pageId: string }; Querystring: { source?: string; after?: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { pageId } = request.params;

        try {
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) return reply.status(404).send({ error: 'Page not found' });

            // Resolve source: explicit param wins; otherwise default to whichever
            // platform the page actually has (FB preferred when both exist).
            const requested = request.query.source;
            const source: 'facebook' | 'instagram' =
                requested === 'instagram' ? 'instagram'
                : requested === 'facebook' ? 'facebook'
                : page.facebookPageId ? 'facebook' : 'instagram';

            // Requested platform not connected, or no usable token → empty page, not an
            // error (the picker simply shows nothing for that source).
            const hasSource = source === 'facebook' ? !!page.facebookPageId : !!page.instagramAccountId;
            if (!hasSource || !page.accessToken) return reply.send({ posts: [], nextCursor: null });

            const result = await postsService.listPublishedPosts(
                { id: page.id, facebookPageId: page.facebookPageId, instagramAccountId: page.instagramAccountId, accessToken: page.accessToken },
                { source, after: request.query.after },
            );
            return reply.send(result);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to list published posts' });
        }
    }

    /**
     * Ensure an internal content row exists for a picked published post, so the standard
     * trigger endpoint can configure it — lets a merchant arm a post BEFORE its first
     * comment. Idempotent. Returns the internal id + current trigger fields.
     * POST /posts/ensure  { pageId, source, platformPostId }
     */
    async ensurePost(
        request: FastifyRequest<{ Body: { pageId?: string; source?: string; platformPostId?: string } }>,
        reply: FastifyReply,
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { pageId, source, platformPostId } = request.body;

        if (source !== 'facebook' && source !== 'instagram') {
            return reply.status(400).send({ error: 'source must be facebook or instagram' });
        }
        if (!pageId || !platformPostId?.trim()) {
            return reply.status(400).send({ error: 'pageId and platformPostId are required' });
        }

        try {
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) return reply.status(404).send({ error: 'Page not found' });

            const content = await postsService.ensureContent(
                { id: page.id, facebookPageId: page.facebookPageId, instagramAccountId: page.instagramAccountId, accessToken: page.accessToken },
                source, platformPostId.trim(),
            );
            return reply.send(content);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to prepare post' });
        }
    }

    /**
     * Get a single post
     * GET /posts/:id
     */
    async getOne(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;

        try {
            const post = await postsService.getPost(id, req.workspaceId);
            if (!post) {
                return reply.status(404).send({ error: 'Post not found' });
            }
            return reply.send(post);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch post' });
        }
    }

    /**
     * Update a post
     * PUT /posts/:id
     */
    async update(request: FastifyRequest<{ Params: { id: string }; Body: UpdatePostDTO }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;

        try {
            const post = await postsService.updatePostByWorkspace(id, request.body, req.workspaceId);
            if (!post) {
                return reply.status(404).send({ error: 'Post not found' });
            }
            return reply.send(post);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update post' });
        }
    }

    /**
     * Delete a post
     * DELETE /posts/:id
     */
    async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;

        try {
            const deleted = await postsService.deletePost(id, req.workspaceId);
            if (!deleted) return reply.status(404).send({ error: 'Post not found' });
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete post' });
        }
    }

    /**
     * Toggle auto-reply for a post
     * PATCH /posts/:id/auto-reply
     */
    async toggleAutoReply(request: FastifyRequest<{ Params: { id: string }; Body: { enabled: boolean } }>, reply: FastifyReply) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;
        const { enabled } = request.body;

        try {
            const post = await postsService.toggleAutoReply(id, enabled, req.workspaceId);
            if (!post) {
                return reply.status(404).send({ error: 'Post not found' });
            }
            return reply.send(post);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to toggle auto-reply' });
        }
    }

    /**
     * Update trigger keyword + reply for a post or Instagram media
     * PATCH /posts/:id/trigger
     */
    async updateTrigger(
        request: FastifyRequest<{
            Params: { id: string };
            Body: {
                source: 'facebook' | 'instagram';
                triggerKeyword: string | null;
                triggerReply: string | null;
                triggerType?: 'keyword' | 'all';
                // Image intent: absent/undefined = leave as-is; null = remove; object = set a new image.
                triggerImage?: { base64: string; mimeType: string } | null;
            };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;
        const { source, triggerKeyword, triggerReply, triggerType, triggerImage } = request.body;

        if (!['facebook', 'instagram'].includes(source)) {
            return reply.status(400).send({ error: 'Invalid source: must be facebook or instagram' });
        }

        // Default only when the field is ABSENT (pre-triggerType clients). A present
        // but invalid value must 400 via the validator below, not silently coerce
        // to keyword mode.
        const rawType: string = triggerType ?? 'keyword';
        const keyword = triggerKeyword?.trim() || null;
        const replyText = triggerReply?.trim() || null;
        const hasImage = triggerImage !== null && triggerImage !== undefined;

        // Reject an image on a feature that isn't configured, before any other work —
        // the send path can't deliver it, so accepting the upload would be a lie.
        if (hasImage && !imageStorage.isConfigured()) {
            return reply.status(400).send({ error: 'Image attachments are not available' });
        }

        try {
            // Clearing the trigger: both keyword and reply empty → remove the rule (fields
            // nulled, type reset to the default). Any attached image is dropped too.
            if (!keyword && !replyText) {
                const cleared = await postsService.updateTrigger(id, source, null, null, req.workspaceId, 'keyword', { action: 'remove' });
                if (!cleared.ok) return reply.status(404).send({ error: 'Post not found' });
                return reply.send({ success: true });
            }

            // Setting: validate keyword vs any-comment shape via the shared validator. A
            // partial trigger (keyword without a reply) fails here — triggerReply is required.
            // With an image attached the reply cap tightens to 160 (card title+subtitle).
            const validationError = validatePostReplyRuleInput({ triggerType: rawType, triggerKeyword: keyword, triggerReply: replyText, hasImage });
            if (validationError) return reply.status(400).send({ error: validationError });

            // Decode + validate the image (allowlist, size, magic-byte match) before upload.
            let imageIntent: TriggerImageInput = triggerImage === null ? { action: 'remove' } : { action: 'keep' };
            if (triggerImage) {
                if (typeof triggerImage.base64 !== 'string' || triggerImage.base64.length === 0) {
                    return reply.status(400).send({ error: 'Invalid image data' });
                }
                if (!POST_REPLY_IMAGE_MIME_TYPES.includes(triggerImage.mimeType as typeof POST_REPLY_IMAGE_MIME_TYPES[number])) {
                    return reply.status(400).send({ error: 'Unsupported image type. Use JPG, PNG, or WEBP' });
                }
                const buffer = Buffer.from(triggerImage.base64, 'base64');
                if (buffer.length === 0) {
                    return reply.status(400).send({ error: 'Empty image data' });
                }
                if (buffer.length > POST_REPLY_IMAGE_MAX_BYTES) {
                    return reply.status(413).send({ error: 'Image too large (max 2 MB)' });
                }
                if (!bufferMatchesMime(buffer, triggerImage.mimeType)) {
                    return reply.status(400).send({ error: 'file_content_mismatch', message: 'Image contents do not match the declared type.' });
                }
                imageIntent = { action: 'set', buffer, mimeType: triggerImage.mimeType };
            }

            // Validation guarantees rawType is 'keyword' | 'all' past this point.
            const type: 'keyword' | 'all' = rawType === 'all' ? 'all' : 'keyword';
            // Any-comment mode stores no keyword.
            const storedKeyword = type === 'all' ? null : keyword;
            const result = await postsService.updateTrigger(id, source, storedKeyword, replyText, req.workspaceId, type, imageIntent);
            if (!result.ok) {
                if (result.reason === 'quota_exceeded') {
                    return reply.status(413).send({ error: 'image_quota_exceeded', message: 'Image storage limit reached for this workspace' });
                }
                if (result.reason === 'reply_too_long_with_image') {
                    return reply.status(400).send({ error: 'reply_too_long_with_image', message: 'With an image attached, the reply must be 160 characters or fewer' });
                }
                return reply.status(404).send({ error: 'Post not found' });
            }
            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to update trigger' });
        }
    }
}

export const postsController = new PostsController();
