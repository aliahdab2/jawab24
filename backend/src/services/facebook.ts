import axios from 'axios';
import { config } from '../config';
import { tracedExternalCall } from '../utils/tracing';
import { fbAxios, GRAPH_API_BASE } from '../lib/fbAxios';
import * as Sentry from '@sentry/node';
import type { FacebookTokenResponse, FacebookUserProfile, FacebookPagesResponse, FacebookPage, FacebookGranularScope, Logger } from '../types';
import { noopLogger } from '../types';
import { fetchNameFromConversationsApi } from './reply/adapters/shared';
import { DmSendError, FacebookApiError } from '../utils/fbGraphErrors';
import { buildMessagePayload, buildCommentReplyPayload, imageCardMessage, type SendMessageOptions } from './metaMessaging';
import { POST_REPLY_CARD_CAPTION_MAX } from '@jawab24/shared';
export type { MessagingType, SendMessageOptions } from './metaMessaging';

const traced = <T>(method: string, fn: () => Promise<T>) =>
    tracedExternalCall('facebook', method, fn);

const FACEBOOK_GRAPH_API = GRAPH_API_BASE;
const DEFAULT_TOKEN_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000; // 60 days — Facebook long-lived token default

// Fields shared by /me/accounts (primary) and /{page-id} (fallback) page fetches.
// The `tasks` field is ONLY requestable on /me/accounts — Graph API rejects it on /{page-id}.
const PAGE_BASE_FIELDS = 'id,name,access_token,category,about,phone,single_line_address,hours,website';
const PAGE_FIELDS_PRIMARY = `${PAGE_BASE_FIELDS},tasks`;

/** Graph attachment node — only the image bits the posts-scan reads. */
interface GraphAttachment {
    media_type?: string;
    media?: { image?: { src?: string } };
    subattachments?: { data?: GraphAttachment[] };
}

/** Flatten a post's attachment tree into unique full-res photo URLs. An album's
 *  parent node repeats the first child image — the Set dedupes it. Videos and
 *  links carry preview images too; only media_type "photo"/"album" count. */
function collectAttachmentImages(attachments: unknown): string[] {
    const nodes = (attachments as { data?: GraphAttachment[] } | undefined)?.data;
    if (!Array.isArray(nodes)) return [];
    const urls = new Set<string>();
    const visit = (node: GraphAttachment) => {
        const type = node.media_type ?? '';
        if ((type === 'photo' || type === 'album') && node.media?.image?.src) {
            urls.add(node.media.image.src);
        }
        for (const sub of node.subattachments?.data ?? []) visit(sub);
    };
    for (const node of nodes) visit(node);
    return [...urls];
}

export class FacebookService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Exchange OAuth code for access token
     */
    async getAccessToken(code: string, redirectUri?: string): Promise<string> {
        try {
            const response = await traced('getAccessToken', () =>
                fbAxios.get<FacebookTokenResponse>(`${FACEBOOK_GRAPH_API}/oauth/access_token`, {
                    params: {
                        client_id: config.facebook.appId,
                        client_secret: config.facebook.appSecret,
                        redirect_uri: redirectUri || config.facebook.redirectUri,
                        code,
                    },
                }),
            );

            return response.data.access_token;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Facebook API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Verify access token validity and metadata
     */
    async verifyAccessToken(accessToken: string): Promise<{ isValid: boolean; userId: string; expiresAt: number; scopes: string[]; granularScopes: FacebookGranularScope[] }> {
        try {
            const appAccessToken = `${config.facebook.appId}|${config.facebook.appSecret}`;
            const response = await traced('verifyAccessToken', () =>
                fbAxios.get(`${FACEBOOK_GRAPH_API}/debug_token`, {
                    params: {
                        input_token: accessToken,
                        access_token: appAccessToken,
                    },
                }),
            );

            const data = response.data.data;

            if (!data.is_valid) {
                 throw new Error('Invalid access token');
            }

            // Security check: Ensure token was issued to OUR app
            if (data.app_id !== config.facebook.appId) {
                throw new Error('Token issued to a different app');
            }

            return {
                isValid: data.is_valid,
                userId: data.user_id,
                expiresAt: data.expires_at,
                scopes: data.scopes || [],
                granularScopes: data.granular_scopes || [],
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Facebook Token Verification failed: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }
    async getUserProfile(accessToken: string): Promise<FacebookUserProfile> {
        try {
            const response = await traced('getUserProfile', () =>
                fbAxios.get(`${FACEBOOK_GRAPH_API}/me`, {
                    params: {
                        fields: 'id,name,email,picture.type(large)',
                        access_token: accessToken,
                    },
                }),
            );

            // Extract picture URL from nested structure
            const data = response.data;
            const pictureUrl = data.picture?.data?.url;

            return {
                id: data.id,
                name: data.name,
                email: data.email,
                picture: pictureUrl,
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Facebook API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Get user's Facebook pages with access tokens.
     *
     * Primary path: GET /me/accounts. For most users this returns all pages they admin.
     *
     * Fallback path: For pages owned by a Meta Business Portfolio, /me/accounts may return
     * empty even when the user has "Facebook access with Full control". In that case we
     * inspect `granular_scopes` from /debug_token to discover the page IDs the user
     * authorized, then fetch each page individually via GET /{page-id}.
     *
     * The `tasks` field is only requestable on /me/accounts — Graph API rejects it on
     * /{page-id} — so fallback pages have `tasks` undefined. Downstream code already
     * treats that field as optional.
     */
    async getUserPages(accessToken: string): Promise<FacebookPagesResponse> {
        // --- Primary path: /me/accounts ---
        let primaryResponse: FacebookPagesResponse;
        try {
            this.logger.debug('[Facebook] Fetching user pages via /me/accounts');
            const response = await traced('getUserPages', () =>
                fbAxios.get<FacebookPagesResponse>(`${FACEBOOK_GRAPH_API}/me/accounts`, {
                    params: {
                        access_token: accessToken,
                        fields: PAGE_FIELDS_PRIMARY,
                    },
                }),
            );
            primaryResponse = response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] API Error fetching pages', {
                    error: error.response?.data?.error?.message || error.message,
                });
                throw FacebookApiError.fromAxios(error, 'Facebook API error');
            }
            throw error;
        }

        const primaryPages = primaryResponse.data ?? [];
        if (primaryPages.length > 0) {
            this.logger.info('[Facebook] /me/accounts returned pages', { count: primaryPages.length });
            this.logger.debug('[Facebook] Page names', { pages: primaryPages.map(p => p.name) });
            this.breadcrumb('getUserPages: primary /me/accounts path', 'info', { count: primaryPages.length });
            return primaryResponse;
        }

        // --- Fallback path: granular_scopes from /debug_token ---
        // /me/accounts is empty but the user may still have Business-Portfolio-owned pages
        // authorized via Facebook's per-page granular permission model.
        this.logger.info('[Facebook] /me/accounts empty, entering granular_scopes fallback');
        this.breadcrumb('getUserPages: /me/accounts empty, entering fallback', 'info');

        const pageIds = await this.extractAuthorizedPageIds(accessToken);
        if (pageIds.length === 0) {
            this.logger.info('[Facebook] No page IDs in granular_scopes — user authorized 0 pages');
            this.breadcrumb('getUserPages: fallback found no granular_scopes target_ids', 'info');
            return { data: [] };
        }

        this.logger.info('[Facebook] Found page IDs in granular_scopes', { count: pageIds.length, pageIds });

        // Fetch each page individually in parallel. Per-page failures are isolated so a
        // single bad page doesn't block the rest of the sync.
        const results = await Promise.allSettled(
            pageIds.map(pageId => this.fetchPageById(pageId, accessToken)),
        );

        const recoveredPages: FacebookPage[] = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const pageId = pageIds[i];
            if (result.status === 'fulfilled' && result.value) {
                // Guard: Graph API sometimes returns a page object without access_token
                // (e.g., user lacks pages_read_engagement on that specific page). Such pages
                // are unusable for our purposes — skip them rather than storing a broken row.
                if (!result.value.access_token) {
                    this.logger.warn('[Facebook] Fallback page missing access_token — skipping', {
                        pageId,
                        name: result.value.name,
                    });
                    this.breadcrumb(`getUserPages: fallback page ${pageId} missing access_token`, 'warning');
                    continue;
                }
                recoveredPages.push(result.value);
                this.logger.info('[Facebook] Recovered page via fallback', {
                    pageId,
                    name: result.value.name,
                });
            } else if (result.status === 'rejected') {
                this.logger.warn('[Facebook] Failed to fetch page via fallback', {
                    pageId,
                    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                });
                this.breadcrumb(`getUserPages: fallback failed for page ${pageId}`, 'warning');
            }
        }

        if (recoveredPages.length > 0) {
            this.logger.info('[Facebook] Recovered pages via granular_scopes fallback', {
                count: recoveredPages.length,
            });
            this.breadcrumb('getUserPages: fallback success', 'info', { count: recoveredPages.length });
        } else {
            this.logger.warn('[Facebook] granular_scopes had page IDs but all fetches failed');
            this.breadcrumb('getUserPages: fallback could not recover any page', 'warning');
        }

        return { data: recoveredPages };
    }

    /** Shared Sentry breadcrumb helper for Facebook service events. */
    private breadcrumb(message: string, level: 'info' | 'warning', data?: Record<string, unknown>): void {
        Sentry.addBreadcrumb({ category: 'facebook', message, level, ...(data && { data }) });
    }

    /**
     * Extract unique Page IDs authorized in the user's token via granular_scopes.
     * Business Portfolio-owned pages often only appear here, not in /me/accounts.
     */
    private async extractAuthorizedPageIds(accessToken: string): Promise<string[]> {
        const tokenInfo = await this.verifyAccessToken(accessToken);
        const pageIds = new Set<string>();
        for (const scope of tokenInfo.granularScopes) {
            if (scope.scope.startsWith('pages_') && Array.isArray(scope.target_ids)) {
                for (const id of scope.target_ids) {
                    if (id) pageIds.add(id);
                }
            }
        }
        return [...pageIds];
    }

    /**
     * Fetch a single page by ID with user token. The `tasks` field is intentionally
     * omitted — Graph API rejects it on /{page-id}. It's optional on FacebookPage.
     */
    private async fetchPageById(pageId: string, accessToken: string): Promise<FacebookPage> {
        const response = await traced('getUserPages.fallback', () =>
            fbAxios.get<FacebookPage>(`${FACEBOOK_GRAPH_API}/${pageId}`, {
                params: {
                    access_token: accessToken,
                    fields: PAGE_BASE_FIELDS,
                },
            }),
        );
        return response.data;
    }

    /**
     * Exchange short-lived token for long-lived token (60 days)
     */
    async getLongLivedToken(shortLivedToken: string): Promise<{ token: string; expiresAt: Date }> {
        try {
            const response = await traced('getLongLivedToken', () =>
                fbAxios.get(`${FACEBOOK_GRAPH_API}/oauth/access_token`, {
                    params: {
                        grant_type: 'fb_exchange_token',
                        client_id: config.facebook.appId,
                        client_secret: config.facebook.appSecret,
                        fb_exchange_token: shortLivedToken,
                    },
                }),
            );

            const data = response.data;
            const expiresIn = data.expires_in ? data.expires_in * 1000 : DEFAULT_TOKEN_EXPIRY_MS;

            return {
                token: data.access_token,
                expiresAt: new Date(Date.now() + expiresIn)
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw FacebookApiError.fromAxios(error, 'Facebook API error');
            }
            throw error;
        }
    }
    /**
     * Send a sender_action to Messenger. Cosmetic — never blocks the reply.
     * Failures surface as warn so we can spot regressions like dropped
     * permissions or Graph API shape changes.
     */
    private async sendSenderAction(
        pageAccessToken: string,
        recipientId: string,
        action: 'typing_on' | 'typing_off',
    ): Promise<void> {
        try {
            await axios.post(`${FACEBOOK_GRAPH_API}/me/messages`, {
                recipient: { id: recipientId },
                sender_action: action,
            }, {
                params: { access_token: pageAccessToken },
            });
        } catch (error) {
            const fbError = (error as { response?: { data?: unknown; status?: number } })?.response;
            this.logger.warn(`[Facebook] ${action} failed (non-fatal)`, {
                recipientId,
                status: fbError?.status,
                data: fbError?.data,
            });
        }
    }

    /** Show "typing..." while the bot is preparing a reply. */
    async sendTypingIndicator(pageAccessToken: string, recipientId: string): Promise<void> {
        return this.sendSenderAction(pageAccessToken, recipientId, 'typing_on');
    }

    /**
     * Clear the "typing..." indicator. Used on abort paths (spam, hold, empty)
     * where typing_on was sent but no reply will follow — without this the
     * indicator stays visible for ~20s until Messenger's auto-clear timer fires.
     */
    async sendTypingOff(pageAccessToken: string, recipientId: string): Promise<void> {
        return this.sendSenderAction(pageAccessToken, recipientId, 'typing_off');
    }

    /**
     * Like a comment as the page (Post Reply "like the comment" option).
     * `POST /{comment-id}/likes` with the page token — covered by the
     * `pages_manage_engagement` permission we already hold for comment replies.
     * Facebook-only: the Instagram API has no like-comment endpoint.
     *
     * Best-effort and self-contained, exactly like sendSenderAction: it uses plain
     * `axios` (NOT the retrying fbAxios — a cosmetic like must not sleep 60s on a
     * rate limit inside a fire-and-forget promise), swallows failures, and NEVER
     * throws so a like can't affect the reply. Logs only status + FB error data —
     * never the raw AxiosError, whose `config.params` carries the page access token.
     */
    async likeComment(commentId: string, pageAccessToken: string): Promise<void> {
        try {
            await axios.post(`${FACEBOOK_GRAPH_API}/${commentId}/likes`, null, {
                params: { access_token: pageAccessToken },
                timeout: 15_000,
            });
        } catch (error) {
            const fbError = (error as { response?: { data?: unknown; status?: number } })?.response;
            this.logger.warn('[Facebook] like comment failed (non-fatal)', {
                commentId,
                status: fbError?.status,
                data: fbError?.data,
            });
        }
    }

    /**
     * Send a private reply to a Facebook comment.
     * Uses /me/messages with recipient.comment_id which works for any commenter
     * without requiring prior Messenger interaction.
     */
    async sendPrivateReplyToComment(pageAccessToken: string, commentId: string, text: string): Promise<{ recipientId: string }> {
        try {
            const response = await traced('sendPrivateReplyToComment', () =>
                fbAxios.post<{ recipient_id: string }>(`${FACEBOOK_GRAPH_API}/me/messages`, {
                    recipient: { comment_id: commentId },
                    message: { text },
                }, {
                    params: {
                        access_token: pageAccessToken,
                    },
                }),
            );
            return { recipientId: response.data.recipient_id };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw DmSendError.fromAxios(error, 'Facebook API error', { verboseDetail: true });
            }
            throw error;
        }
    }

    /**
     * Send a private reply to a comment that carries a Post Reply IMAGE, in the single
     * message Meta allows per comment (a follow-up second message is rejected until the
     * customer replies — the root cause of images never arriving). Chooses the format that
     * shows the most:
     *   - caption fits a card title (≤80) → inline image card (image shown in-chat + caption)
     *   - longer → button template (full text ≤640 + a "view image" web_url button)
     * `viewImageLabel` is the already-localized button title (caller resolves it via i18n).
     */
    async sendPrivateReplyWithImage(
        pageAccessToken: string,
        commentId: string,
        text: string,
        imageUrl: string,
        readMore: { label: string; payload: string } | null,
    ): Promise<{ recipientId: string; format: 'card' | 'card_readmore' }> {
        // The image ALWAYS rides an inline card (image never hidden). A short caption fits the
        // card title in full; a long one shows a teaser + a «Read more» postback button, and the
        // full text is delivered as a follow-up DM when the customer taps it (the image stays in
        // the card — tapped for full size — and is never re-sent).
        const isLong = text.trim().length > POST_REPLY_CARD_CAPTION_MAX;
        const readMoreBtn = isLong && readMore ? { title: readMore.label, payload: readMore.payload } : undefined;
        const message = imageCardMessage(imageUrl, text, readMoreBtn);
        try {
            const response = await traced('sendPrivateReplyWithImage', () =>
                fbAxios.post<{ recipient_id: string }>(
                    `${FACEBOOK_GRAPH_API}/me/messages`,
                    buildCommentReplyPayload(commentId, message),
                    { params: { access_token: pageAccessToken } },
                ),
            );
            return { recipientId: response.data.recipient_id, format: readMoreBtn ? 'card_readmore' : 'card' };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw DmSendError.fromAxios(error, 'Facebook API error', { verboseDetail: true });
            }
            throw error;
        }
    }


    /**
     * Send a private message to a user.
     *
     * `opts.messagingType` defaults to 'RESPONSE' — unchanged for all existing callers.
     * Proactive sends (outside the 24h window) must pass 'MESSAGE_TAG' + an approved `tag`.
     */
    async sendPrivateMessage(
        pageAccessToken: string,
        recipientId: string,
        text: string,
        opts?: SendMessageOptions,
    ): Promise<void> {
        try {
            await traced('sendPrivateMessage', () =>
                fbAxios.post(
                    `${FACEBOOK_GRAPH_API}/me/messages`,
                    buildMessagePayload(recipientId, { text }, opts),
                    { params: { access_token: pageAccessToken } },
                ),
            );
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw DmSendError.fromAxios(error, 'Facebook API error', { verboseDetail: true });
            }
            throw error;
        }
    }

    /**
     * Get post content from Facebook
     * Fetches the message/text content of a post
     */
    async getPostContent(postId: string, pageAccessToken: string): Promise<string | null> {
        try {
            this.logger.debug('[Facebook] Fetching post content', { postId });
            const response = await traced('getPostContent', () =>
                fbAxios.get(`${FACEBOOK_GRAPH_API}/${postId}`, {
                    params: {
                        fields: 'message,story,created_time',
                        access_token: pageAccessToken,
                    },
                }),
            );

            const message = response.data.message || response.data.story || null;
            this.logger.debug('[Facebook] Post content fetched', {
                postId,
                hasContent: !!message,
                contentPreview: message ? message.substring(0, 50) : null
            });
            return message;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] Error fetching post', {
                    postId,
                    error: error.response?.data?.error?.message || error.message
                });
                // Don't throw - just return null if we can't fetch the post
                return null;
            }
            return null;
        }
    }

    /**
     * List a page's recent published posts (newest first) for the Post Reply picker.
     * Returns the id, text, thumbnail, timestamp, and comment count plus a Graph cursor
     * for "load more". Fail-soft: an API error returns an empty page rather than throwing,
     * so a token blip degrades the picker to empty instead of erroring the whole request.
     *
     * `fullImages` (catalog posts-scan) additionally requests the attachment tree
     * and returns every full-resolution image URL per post. `full_picture` alone
     * is not enough there: it is a single downscaled preview, and album posts
     * (course schedules, product line-ups) carry their content in subattachments —
     * low-res thumbnails garble Arabic in Vision OCR (07-11 smoke-test lesson).
     */
    async getPagePosts(
        pageId: string,
        pageAccessToken: string,
        opts?: { limit?: number; after?: string; fullImages?: boolean },
    ): Promise<{ posts: Array<{ id: string; message: string | null; imageUrl: string | null; imageUrls: string[]; createdTime: string | null; commentsCount: number | null }>; nextCursor: string | null }> {
        try {
            const attachmentFields = opts?.fullImages
                ? ',attachments{media_type,media{image{src}},subattachments.limit(20){media_type,media{image{src}}}}'
                : '';
            const response = await traced('getPagePosts', () =>
                fbAxios.get(`${FACEBOOK_GRAPH_API}/${pageId}/posts`, {
                    params: {
                        fields: `id,message,full_picture,created_time,comments.summary(true).limit(0)${attachmentFields}`,
                        limit: opts?.limit ?? 5,
                        ...(opts?.after ? { after: opts.after } : {}),
                        access_token: pageAccessToken,
                    },
                }),
            );
            const data = (response.data?.data ?? []) as Array<Record<string, unknown>>;
            const posts = data.map((p) => ({
                id: String(p.id),
                message: (p.message as string) || null,
                imageUrl: (p.full_picture as string) || null,
                imageUrls: collectAttachmentImages(p.attachments),
                createdTime: (p.created_time as string) || null,
                commentsCount: ((p.comments as { summary?: { total_count?: number } })?.summary?.total_count) ?? null,
            }));
            const nextCursor = (response.data?.paging?.cursors?.after as string) || null;
            return { posts, nextCursor };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] Error listing page posts', {
                    pageId,
                    error: error.response?.data?.error?.message || error.message,
                });
                return { posts: [], nextCursor: null };
            }
            return { posts: [], nextCursor: null };
        }
    }

    /**
     * Get comment details from Facebook
     */
    async getCommentDetails(commentId: string, pageAccessToken: string): Promise<{
        message: string;
        from?: { id: string; name: string };
    } | null> {
        try {
            const response = await traced('getCommentDetails', () =>
                fbAxios.get(`${FACEBOOK_GRAPH_API}/${commentId}`, {
                    params: {
                        fields: 'message,from',
                        access_token: pageAccessToken,
                    },
                }),
            );

            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] Error fetching comment', {
                    commentId,
                    error: error.response?.data?.error?.message || error.message
                });
                return null;
            }
            return null;
        }
    }

    /**
     * Fetch a comment's authoritative metadata including `message_tags`. Used
     * when the Page feed webhook omitted the tag array — a documented FB
     * consistency gap we hit in production with real structured user tags.
     * Returns null on any error so the caller can fail-closed without throwing.
     */
    async getCommentWithTags(commentId: string, pageAccessToken: string): Promise<{
        message: string;
        message_tags?: Array<{ id: string; name: string; type: 'user' | 'page'; offset: number; length: number }>;
        from?: { id: string; name: string };
        parent?: { id: string };
    } | null> {
        try {
            const response = await traced('getCommentWithTags', () =>
                fbAxios.get(`${FACEBOOK_GRAPH_API}/${commentId}`, {
                    params: {
                        fields: 'message,message_tags,from,parent',
                        access_token: pageAccessToken,
                    },
                }),
            );
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] Error fetching comment with tags', {
                    commentId,
                    error: error.response?.data?.error?.message || error.message,
                });
            }
            return null;
        }
    }
    /**
     * Fetch a Messenger sender's name using the page access token.
     * Tries User Profile API first, then falls back to Conversations API.
     * pageId is required for the Conversations API fallback.
     */
    async getSenderProfile(senderId: string, pageAccessToken: string, pageId?: string): Promise<{ name: string } | null> {
        // Try User Profile API first
        try {
            const response = await traced('getSenderProfile', () =>
                fbAxios.get(`${FACEBOOK_GRAPH_API}/${senderId}`, {
                    params: {
                        fields: 'name',
                        access_token: pageAccessToken,
                    },
                }),
            );
            const { name } = response.data;
            if (name) return { name };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.warn('[Facebook] Could not fetch sender profile via User API', {
                    senderId,
                    error: error.response?.data?.error?.message || error.message,
                });
            }
        }

        // Fallback: Conversations API — returns participant names even when User API is restricted
        if (pageId) {
            try {
                const name = await fetchNameFromConversationsApi(pageId, senderId, pageAccessToken);
                if (name) return { name };
            } catch {
                // Both approaches failed — return null
            }
        }

        return null;
    }

    /**
     * Subscribe a page to receive webhook events (feed + messages)
     * Must be called after connecting a page so Facebook sends events to our webhook
     */
    async subscribePageToWebhooks(pageId: string, pageAccessToken: string): Promise<boolean> {
        try {
            this.logger.info('[Facebook] Subscribing page to webhooks', { pageId });
            await traced('subscribePageToWebhooks', () =>
                fbAxios.post(`${FACEBOOK_GRAPH_API}/${pageId}/subscribed_apps`, null, {
                    params: {
                        // messaging_postbacks: the Post Reply «Read more» button tap. Without it Meta
                        // never delivers the postback, so existing pages must be re-subscribed.
                        subscribed_fields: 'feed,messages,messaging_postbacks',
                        access_token: pageAccessToken,
                    },
                }),
            );
            this.logger.info('[Facebook] Page subscribed to webhooks (feed+messages+postbacks)', { pageId });
            return true;
        } catch (error) {
            // feed requires pages_manage_metadata — fall back to messages-only if missing
            const fbError = axios.isAxiosError(error) ? error.response?.data?.error : null;
            if (fbError && fbError.code === 200 && /pages_manage_metadata/i.test(fbError.message)) {
                this.logger.warn('[Facebook] pages_manage_metadata missing, subscribing to messages only', { pageId });
                try {
                    await traced('subscribePageToWebhooks.messagesOnly', () =>
                        fbAxios.post(`${FACEBOOK_GRAPH_API}/${pageId}/subscribed_apps`, null, {
                            params: {
                                subscribed_fields: 'messages,messaging_postbacks',
                                access_token: pageAccessToken,
                            },
                        }),
                    );
                    this.logger.info('[Facebook] Page subscribed to webhooks (messages+postbacks only)', { pageId });
                    return true;
                } catch (retryError) {
                    if (axios.isAxiosError(retryError)) {
                        this.logger.error('[Facebook] Failed to subscribe page to messages webhooks', {
                            pageId,
                            error: retryError.response?.data?.error?.message || retryError.message,
                        });
                    }
                    return false;
                }
            }
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] Failed to subscribe page to webhooks', {
                    pageId,
                    error: error.response?.data?.error?.message || error.message,
                });
            }
            return false;
        }
    }

    /**
     * Unsubscribe a page from webhook events
     */
    async unsubscribePageFromWebhooks(pageId: string, pageAccessToken: string): Promise<boolean> {
        try {
            this.logger.info('[Facebook] Unsubscribing page from webhooks', { pageId });
            await traced('unsubscribePageFromWebhooks', () =>
                fbAxios.delete(`${FACEBOOK_GRAPH_API}/${pageId}/subscribed_apps`, {
                    params: {
                        access_token: pageAccessToken,
                    },
                }),
            );
            this.logger.info('[Facebook] Page unsubscribed from webhooks', { pageId });
            return true;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] Failed to unsubscribe page from webhooks', {
                    pageId,
                    error: error.response?.data?.error?.message || error.message,
                });
            }
            return false;
        }
    }
}

export const facebookService = new FacebookService();
