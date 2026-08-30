import { FastifyReply, FastifyRequest } from 'fastify';
import { POST_REPLY_IMAGE_MAX_BYTES, POST_REPLY_BUTTON_TEXT_MAX, isPlausiblePlatformPostId } from '@jawab24/shared';
import { postsService, PostNotOwnedError, type TriggerImageInput } from '../services/posts';
import { pagesService } from '../services/pages';
import { resolveInstagramCredential } from '../services/instagramCredential';
import { validatePostReplyRuleInput } from '../services/reply/postReplyRule';
import { imageStorage } from '../services/imageStorage';
import { validateAndNormalizeUpload } from '../services/imageUpload';
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
     * GET /pages/:pageId/published-posts?source=facebook|instagram&after=<cursor>&includeScheduled=1
     *
     * `includeScheduled=1` adds the Facebook page's still-pending posts at the top. It is
     * OPT-IN because the mobile app ships its own frontend bundle: an app build that
     * predates the field would render a scheduled post as a published one with no date,
     * and let the merchant arm it with no notice that the post isn't live yet.
     */
    async getPublishedPosts(
        request: FastifyRequest<{ Params: { pageId: string }; Querystring: { source?: string; after?: string; includeScheduled?: string } }>,
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

            // Requested platform not connected → empty page, not an error (the picker
            // simply shows nothing for that source), and genuinely COMPLETE: there is
            // no list to be missing anything from.
            const hasSource = source === 'facebook' ? !!page.facebookPageId : !!page.instagramAccountId;
            if (!hasSource) return reply.send({ posts: [], nextCursor: null, partial: false });

            // Source connected but no usable token → still an empty page, but the list
            // is INCOMPLETE and must say so.
            //
            // `partial: false` here is an assertion that the merchant has no posts, and
            // it is exactly the wrong one when the credential is the thing that is
            // missing: `pageTokenRecovery.markPageNeedsReconnect` clears `access_token`
            // the moment Facebook confirms it is revoked, so the FIRST failure moves
            // this page from "read failed → partial: true" (which at least showed the
            // "list may be incomplete" hint) to a confidently complete empty list. That
            // is the 2026-08-14 screen — «لا توجد منشورات حديثة على هذه الصفحة» — with
            // its one remaining clue removed. The reconnect card is raised separately;
            // this keeps the picker itself from contradicting it.
            //
            // Channel-aware (PR #772 review H2): an Instagram-direct row keeps
            // `access_token` at the '' sentinel and holds its credential in
            // `instagram_access_token`, so the guard must ask about the token the
            // REQUESTED source actually sends with — the bare `!page.accessToken`
            // read returned a confidently empty picker for every such page.
            const sourceToken = source === 'instagram'
                ? resolveInstagramCredential(page).accessToken
                : page.accessToken;
            if (!sourceToken) return reply.send({ posts: [], nextCursor: null, partial: true });

            const includeScheduled = request.query.includeScheduled === '1' || request.query.includeScheduled === 'true';
            const result = await postsService.listPublishedPosts(
                {
                    id: page.id,
                    facebookPageId: page.facebookPageId,
                    instagramAccountId: page.instagramAccountId,
                    accessToken: page.accessToken,
                    instagramAccessToken: page.instagramAccessToken,
                },
                { source, after: request.query.after, includeScheduled },
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
        // Reject at the boundary rather than spending a Graph call on it. The id reaches
        // Graph URL paths (getPostSchedule / getPostContent, both encoded there too), so
        // anything that could steer a path has no business getting that far.
        if (!isPlausiblePlatformPostId(platformPostId.trim())) {
            return reply.status(400).send({ error: 'platformPostId is not a valid post id' });
        }

        try {
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) return reply.status(404).send({ error: 'Page not found' });

            const content = await postsService.ensureContent(
                {
                    id: page.id,
                    facebookPageId: page.facebookPageId,
                    instagramAccountId: page.instagramAccountId,
                    accessToken: page.accessToken,
                    instagramAccessToken: page.instagramAccessToken,
                },
                source, platformPostId.trim(),
            );
            return reply.send(content);
        } catch (error) {
            // The post id resolved to another page's row — same response as an
            // unknown post; don't confirm the id exists elsewhere.
            if (error instanceof PostNotOwnedError) {
                return reply.status(404).send({ error: 'Post not found' });
            }
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
                // Like the customer's comment on a successful send. Absent = leave as-is
                // (like triggerImage's keep semantics) so a client that doesn't know the
                // field can't wipe it. Facebook-only — coerced to false for Instagram.
                likeComment?: boolean;
                // Mention the commenter in the public comment. Same keep semantics as
                // likeComment. Facebook-only — coerced to false for Instagram.
                tagCommenter?: boolean;
                // Veto keywords: absent = leave as-is (keep); null/'' = clear; string = set.
                triggerExcludeKeyword?: string | null;
                // CTA button (Facebook-only): absent = keep; null/'' = clear; string = set.
                // Both required together — coerced to false for Instagram (no button columns).
                triggerButtonLabel?: string | null;
                triggerButtonUrl?: string | null;
            };
        }>,
        reply: FastifyReply,
    ) {
        const req = request as WorkspaceRequest;
        if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params;
        const { source, triggerKeyword, triggerReply, triggerType, triggerImage, likeComment, tagCommenter, triggerExcludeKeyword, triggerButtonLabel, triggerButtonUrl } = request.body;

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
        // Absent = keep (undefined); present = an explicit set. Only Facebook posts can
        // carry the like option, so any set is coerced to false for Instagram.
        const likeCommentIntent: boolean | undefined =
            likeComment === undefined ? undefined : (source === 'facebook' && likeComment === true);
        // Same keep/coerce rules as likeComment: absent = keep, and Instagram can't carry it
        // (IG mentions need `@username`, a mechanism this column does not describe).
        const tagCommenterIntent: boolean | undefined =
            tagCommenter === undefined ? undefined : (source === 'facebook' && tagCommenter === true);
        // Absent = keep (undefined); empty string = clear (null); otherwise trim + set.
        const excludeIntent: string | null | undefined =
            triggerExcludeKeyword === undefined ? undefined : (triggerExcludeKeyword?.trim() || null);

        // CTA button (Facebook-only). Absent = keep; empty = clear; string = set. Coerced to a
        // cleared button for Instagram (no button columns / unverified button-template support).
        const isFacebook = source === 'facebook';
        const buttonLabelIntent: string | null | undefined = !isFacebook
            ? (triggerButtonLabel === undefined ? undefined : null)
            : (triggerButtonLabel === undefined ? undefined : (triggerButtonLabel?.trim() || null));
        const buttonUrlIntent: string | null | undefined = !isFacebook
            ? (triggerButtonUrl === undefined ? undefined : null)
            : (triggerButtonUrl === undefined ? undefined : (triggerButtonUrl?.trim() || null));

        // Reject an image on a feature that isn't configured, before any other work —
        // the send path can't deliver it, so accepting the upload would be a lie.
        if (hasImage && !imageStorage.isConfigured()) {
            return reply.status(400).send({ error: 'Image attachments are not available' });
        }

        try {
            // Clearing the trigger: both keyword and reply empty → remove the rule (fields
            // nulled, type reset to the default). Any attached image is dropped too.
            if (!keyword && !replyText) {
                // Clearing the rule resets the like option + veto keywords too (a removed
                // trigger owns nothing).
                const cleared = await postsService.updateTrigger({
                    contentId: id, source, workspaceId: req.workspaceId,
                    triggerKeyword: null, triggerReply: null, triggerType: 'keyword',
                    image: { action: 'remove' }, likeComment: false, tagCommenter: false, triggerExcludeKeyword: null,
                    triggerButtonLabel: null, triggerButtonUrl: null,
                });
                if (!cleared.ok) return reply.status(404).send({ error: 'Post not found' });
                return reply.send({ success: true });
            }

            // Setting: validate keyword vs any-comment shape via the shared validator. A
            // partial trigger (keyword without a reply) fails here — triggerReply is required.
            // The reply cap is a flat 1000 whether or not an image is attached (the image is
            // sent as its own message, so it doesn't eat into the text budget).
            const validationError = validatePostReplyRuleInput({
                triggerType: rawType, triggerKeyword: keyword, triggerReply: replyText,
                triggerExcludeKeyword: excludeIntent,
                triggerButtonLabel: buttonLabelIntent, triggerButtonUrl: buttonUrlIntent,
            });
            if (validationError) return reply.status(400).send({ error: validationError });

            // Decode + validate the image (allowlist, size, magic-byte match) before upload.
            let imageIntent: TriggerImageInput = triggerImage === null ? { action: 'remove' } : { action: 'keep' };
            if (triggerImage) {
                // Shared pipeline (services/imageUpload.ts): allowlist, size, magic
                // bytes, then normalizeImage — which MUST happen here rather than
                // inside imageStorage.put: everything downstream (the quota check,
                // the stored `triggerImageBytes`) has to describe the bytes written.
                const upload = await validateAndNormalizeUpload({
                    base64: triggerImage.base64,
                    mimeType: triggerImage.mimeType,
                    maxBytes: POST_REPLY_IMAGE_MAX_BYTES,
                    sentry: {
                        message: 'Post Reply image could not be normalized',
                        fingerprint: 'post-reply-image-normalize-failed',
                        tags: { source },
                        extra: { workspaceId: req.workspaceId, contentId: id },
                    },
                });
                if (!upload.ok) {
                    switch (upload.code) {
                        case 'unsupported_image_type':
                            return reply.status(400).send({ error: 'Unsupported image type. Use JPG, PNG, or WEBP' });
                        case 'invalid_image':
                            return reply.status(400).send({ error: 'Invalid image data' });
                        case 'image_too_large':
                            return reply.status(413).send({ error: 'Image too large (max 2 MB)' });
                        case 'file_content_mismatch':
                            return reply.status(400).send({ error: 'file_content_mismatch', message: 'Image contents do not match the declared type.' });
                        case 'image_unreadable':
                            return reply.status(400).send({ error: 'image_unreadable', message: 'Image could not be processed. Try a different file.' });
                    }
                }
                imageIntent = { action: 'set', buffer: upload.bytes, mimeType: upload.mimeType };
            }

            // Validation guarantees rawType is 'keyword' | 'all' past this point.
            const type: 'keyword' | 'all' = rawType === 'all' ? 'all' : 'keyword';
            // Any-comment mode stores no keyword.
            const storedKeyword = type === 'all' ? null : keyword;
            const result = await postsService.updateTrigger({
                contentId: id, source, workspaceId: req.workspaceId,
                triggerKeyword: storedKeyword, triggerReply: replyText, triggerType: type,
                image: imageIntent, likeComment: likeCommentIntent, tagCommenter: tagCommenterIntent,
                triggerExcludeKeyword: excludeIntent,
                triggerButtonLabel: buttonLabelIntent, triggerButtonUrl: buttonUrlIntent,
            });
            if (!result.ok) {
                if (result.reason === 'quota_exceeded') {
                    return reply.status(413).send({ error: 'image_quota_exceeded', message: 'Image storage limit reached for this workspace' });
                }
                if (result.reason === 'button_text_too_long') {
                    return reply.status(400).send({ error: 'button_text_too_long', message: `Reply must be ${POST_REPLY_BUTTON_TEXT_MAX} characters or fewer when a button is set without an image` });
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
