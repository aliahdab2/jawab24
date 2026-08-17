import axios from 'axios';
import { config } from '../config';
import { tracedExternalCall } from '../utils/tracing';
import { fbAxios, GRAPH_API_BASE } from '../lib/fbAxios';
import * as Sentry from '@sentry/node';
import type { FacebookTokenResponse, FacebookUserProfile, FacebookPagesResponse, FacebookPage, FacebookGranularScope, Logger } from '../types';
import { noopLogger } from '../types';
import { fetchNameFromConversationsApi } from './reply/adapters/shared';
import { DmSendError, FacebookApiError } from '../utils/fbGraphErrors';
import { buildMessagePayload, buildCommentReplyPayload, imageCardMessage, buttonTemplateMessage, type CtaButton, type SendMessageOptions } from './metaMessaging';
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

/**
 * Turn a failed fail-soft Graph READ into the error shape a caller may safely
 * hold, log and forward, and report it to Sentry with groupable numeric tags.
 *
 * ⚠️ NEVER return the AxiosError itself. The reads below fail soft, so the error
 * is RETURNED rather than thrown — and a returned object travels much further
 * than a caught one (`controllers/posts.ts` does `request.log.error(error)`).
 * `AxiosError.toJSON` — what `JSON.stringify`, pino and Sentry all reach for —
 * serialises `config`, and `config.params.access_token` on these calls is the
 * page's LIVE credential. `FacebookApiError` carries exactly what the one
 * consumer (`pageTokenRecovery`) reads — code, subcode, isTransport, message —
 * and nothing that is a secret.
 *
 * ⚠️ The Graph code/subcode go in TAGS, never only inside the free-text detail.
 * Sentry's server-side scrubbing replaced `extra.error` with "[Filtered]" on
 * JAWAB24-BACKEND-1Z (the message contains "access token"), so the alert that
 * exists to explain this failure could not explain it — the cause had to be read
 * off the server by SSH. Numbers in tags survive scrubbing and are groupable.
 *
 * Shared by both post-list edges on purpose: the 2026-08-14 incident was
 * diagnosed off `/posts`, and instrumenting only `scheduled_posts` would leave
 * the edge that actually failed as invisible as it was that day.
 */
function reportGraphReadFailure(
    error: unknown,
    opts: { pageId: string; message: string; fingerprint: string; detail: string },
): FacebookApiError | undefined {
    const fbError = axios.isAxiosError(error)
        ? (error.response?.data as { error?: { code?: unknown; error_subcode?: unknown } } | undefined)?.error
        : undefined;
    Sentry.captureMessage(opts.message, {
        level: 'warning',
        fingerprint: [opts.fingerprint, opts.pageId],
        tags: {
            fb_code: typeof fbError?.code === 'number' ? String(fbError.code) : 'none',
            fb_subcode: typeof fbError?.error_subcode === 'number' ? String(fbError.error_subcode) : 'none',
        },
        extra: { pageId: opts.pageId, error: opts.detail },
    });
    return axios.isAxiosError(error)
        ? FacebookApiError.fromAxios(error, opts.message)
        : undefined;
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

/** Ceiling on the scheduled-posts edge read. Pending posts are a bounded set pinned to
 *  the top of the picker with no cursor of its own, so this is the hard limit on how many
 *  a merchant can arm ahead of time — `truncated` reports when it bites. */
export const SCHEDULED_POSTS_MAX = 25;

/** Graph returns `scheduled_publish_time` as a UNIX timestamp in SECONDS (typed `float`),
 *  while everything we hand to callers is an ISO string. Anything non-finite — absent,
 *  null, a string Graph didn't parse — is "no schedule", never epoch 0. */
function unixToIso(value: unknown): string | null {
    const seconds = typeof value === 'string' ? Number(value) : value;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000).toISOString();
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
     * Reconciliation path: `/me/accounts` is NOT authoritative for what the user
     * authorized. For pages owned by a Meta Business Portfolio it can omit pages the
     * user granted with "Facebook access with Full control" — returning an empty list,
     * or (the case that cost us a full support night on 2026-08-09) a PARTIAL one: the
     * merchant authorized two pages, `/me/accounts` listed only the older one, and the
     * newly-granted page was invisible to every sync. The authorization truth lives in
     * `granular_scopes` on the token, so we always diff the two and fetch whatever the
     * primary path missed via GET /{page-id}. Treating this as a "fallback" that only
     * ran when the primary list was EMPTY is exactly what hid the partial case.
     *
     * The `tasks` field is only requestable on /me/accounts — Graph API rejects it on
     * /{page-id} — so reconciled pages have `tasks` undefined. Downstream code already
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
        this.logger.info('[Facebook] /me/accounts returned pages', { count: primaryPages.length });
        if (primaryPages.length > 0) {
            this.logger.debug('[Facebook] Page names', { pages: primaryPages.map(p => p.name) });
        }

        // --- Reconciliation: granular_scopes from /debug_token ---
        // The token's granular_scopes are the authorization truth. Fetch anything the
        // user authorized that /me/accounts did not return — whether it omitted ALL
        // pages or just SOME of them.
        // Best-effort when /me/accounts already returned pages: a /debug_token hiccup
        // must never turn a partially-successful sync into a total failure (the revoke
        // step would read that as "user revoked everything").
        let authorizedPageIds: string[];
        try {
            authorizedPageIds = await this.extractAuthorizedPageIds(accessToken);
        } catch (error) {
            if (primaryPages.length > 0) {
                this.logger.warn('[Facebook] granular_scopes lookup failed — returning /me/accounts result as-is', {
                    error: error instanceof Error ? error.message : String(error),
                });
                this.breadcrumb('getUserPages: granular_scopes lookup failed, primary-only result', 'warning');
                return primaryResponse;
            }
            throw error;
        }
        const primaryPageIds = new Set(primaryPages.map(p => p.id));
        const missingPageIds = authorizedPageIds.filter(id => !primaryPageIds.has(id));

        if (missingPageIds.length === 0) {
            this.breadcrumb('getUserPages: primary /me/accounts path complete', 'info', { count: primaryPages.length });
            return primaryResponse;
        }

        this.logger.info('[Facebook] granular_scopes lists pages missing from /me/accounts', {
            primaryCount: primaryPages.length,
            missingCount: missingPageIds.length,
            missingPageIds,
        });
        this.breadcrumb('getUserPages: reconciling pages missing from /me/accounts', 'info', {
            primaryCount: primaryPages.length,
            missingCount: missingPageIds.length,
        });

        // Fetch each missing page individually in parallel. Per-page failures are isolated
        // so a single bad page doesn't block the rest of the sync.
        const results = await Promise.allSettled(
            missingPageIds.map(pageId => this.fetchPageById(pageId, accessToken)),
        );

        const recoveredPages: FacebookPage[] = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const pageId = missingPageIds[i];
            if (result.status === 'fulfilled' && result.value) {
                // Guard: Graph API sometimes returns a page object without access_token
                // (e.g., user lacks pages_read_engagement on that specific page). Such pages
                // are unusable for our purposes — skip them rather than storing a broken row.
                if (!result.value.access_token) {
                    this.logger.warn('[Facebook] Reconciled page missing access_token — skipping', {
                        pageId,
                        name: result.value.name,
                    });
                    this.breadcrumb(`getUserPages: reconciled page ${pageId} missing access_token`, 'warning');
                    continue;
                }
                recoveredPages.push(result.value);
                this.logger.info('[Facebook] Recovered page missing from /me/accounts', {
                    pageId,
                    name: result.value.name,
                });
            } else if (result.status === 'rejected') {
                this.logger.warn('[Facebook] Failed to fetch page missing from /me/accounts', {
                    pageId,
                    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                });
                this.breadcrumb(`getUserPages: reconciliation failed for page ${pageId}`, 'warning');
            }
        }

        if (recoveredPages.length > 0) {
            this.logger.info('[Facebook] Recovered pages via granular_scopes reconciliation', {
                count: recoveredPages.length,
            });
            this.breadcrumb('getUserPages: reconciliation success', 'info', { count: recoveredPages.length });
        } else {
            this.logger.warn('[Facebook] granular_scopes listed missing page IDs but none could be fetched');
            this.breadcrumb('getUserPages: reconciliation could not recover any page', 'warning');
        }

        // Union, never replacement: dropping the primary pages here would make the
        // sync's revoke step disconnect every page /me/accounts DID return.
        return { ...primaryResponse, data: [...primaryPages, ...recoveredPages] };
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
     * Returns whether the like landed, so the caller can count failures
     * (`like_failed` pipeline metric) without this method ever throwing.
     */
    async likeComment(commentId: string, pageAccessToken: string): Promise<boolean> {
        try {
            await axios.post(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(commentId)}/likes`, null, {
                params: { access_token: pageAccessToken },
                timeout: 15_000,
            });
            return true;
        } catch (error) {
            const fbError = (error as { response?: { data?: unknown; status?: number } })?.response;
            this.logger.warn('[Facebook] like comment failed (non-fatal)', {
                commentId,
                status: fbError?.status,
                data: fbError?.data,
            });
            return false;
        }
    }

    /**
     * Send a private reply to a Facebook comment.
     * Uses /me/messages with recipient.comment_id which works for any commenter
     * without requiring prior Messenger interaction.
     *
     * With a `cta` (Post Reply CTA button, no image attached), the reply rides a Button
     * Template so the customer gets a tappable link under the text; otherwise a plain
     * text message. One message only — Meta allows a single send on a cold comment→DM.
     */
    async sendPrivateReplyToComment(pageAccessToken: string, commentId: string, text: string, cta?: CtaButton): Promise<{ recipientId: string }> {
        try {
            const message = cta ? buttonTemplateMessage(text, cta) : { text };
            const response = await traced('sendPrivateReplyToComment', () =>
                fbAxios.post<{ recipient_id: string }>(
                    `${FACEBOOK_GRAPH_API}/me/messages`,
                    buildCommentReplyPayload(commentId, message),
                    { params: { access_token: pageAccessToken } },
                ),
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
        cta?: CtaButton,
        viewUrl?: string,
    ): Promise<{ recipientId: string; format: 'card' | 'card_readmore' }> {
        // The image ALWAYS rides an inline card (image never hidden). A short caption fits the
        // card title in full; a long one shows a teaser + a «Read more» postback button, and the
        // full text is delivered as a follow-up DM when the customer taps it (the image stays in
        // the card — tapped for full size — and is never re-sent). An optional CTA link button
        // rides the same card alongside «Read more» (≤3 buttons per card).
        const isLong = text.trim().length > POST_REPLY_CARD_CAPTION_MAX;
        const readMoreBtn = isLong && readMore ? { title: readMore.label, payload: readMore.payload } : undefined;
        const message = imageCardMessage(imageUrl, text, readMoreBtn, cta, viewUrl);
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
     *
     * `postId` is encoded: this is reachable with a caller-supplied id via
     * POST /posts/ensure → findOrCreateFromWebhook, and a raw path segment would let
     * that id point the read at a different Graph node/edge.
     */
    async getPostContent(postId: string, pageAccessToken: string): Promise<string | null> {
        try {
            this.logger.debug('[Facebook] Fetching post content', { postId });
            const response = await traced('getPostContent', () =>
                fbAxios.get(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(postId)}`, {
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
     * so a token blip degrades the picker to empty instead of erroring the whole request —
     * but `failed: true` marks that path, because a caller that DERIVES state from
     * emptiness (the catalog scan's "up to date") must be able to tell "no posts"
     * from "Graph errored": conflating them told merchants "all up to date" while
     * their token was the thing that broke.
     *
     * `fullImages` (catalog page-scan) additionally requests the attachment tree
     * and returns every full-resolution image URL per post. `full_picture` alone
     * is not enough there: it is a single downscaled preview, and album posts
     * (course schedules, product line-ups) carry their content in subattachments —
     * low-res thumbnails garble Arabic in Vision OCR (07-11 smoke-test lesson).
     */
    async getPagePosts(
        pageId: string,
        pageAccessToken: string,
        opts?: { limit?: number; after?: string; fullImages?: boolean },
    ): Promise<{ posts: Array<{ id: string; message: string | null; imageUrl: string | null; imageUrls: string[]; createdTime: string | null; commentsCount: number | null }>; nextCursor: string | null; failed: boolean; error?: FacebookApiError }> {
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
            return { posts, nextCursor, failed: false };
        } catch (error) {
            const detail = axios.isAxiosError(error)
                ? error.response?.data?.error?.message || error.message
                : String(error);
            this.logger.error('[Facebook] Error listing page posts', { pageId, error: detail });
            // The error rides along with `failed` rather than being swallowed:
            // a caller that owns the page row can tell a dead CREDENTIAL from a
            // Graph blip and start recovery (services/pageTokenRecovery.ts).
            // Degrading to an empty list while discarding the one fact that
            // explains it is what made the 2026-08-14 outage invisible.
            //
            // Normalised, never the raw axios error — see `reportGraphReadFailure`
            // for why returning that object would publish the page token.
            return {
                posts: [], nextCursor: null, failed: true,
                error: reportGraphReadFailure(error, {
                    pageId,
                    message: 'Failed to list page posts',
                    fingerprint: 'fb-page-posts-read-failed',
                    detail,
                }),
            };
        }
    }

    /**
     * List a page's still-SCHEDULED posts for the Post Reply picker, so a merchant can
     * arm a Post Reply before the post goes live (the whole point: the trigger is ready
     * the moment the first comment lands, instead of hours later when someone remembers).
     *
     * `scheduled_publish_time` is a UNIX timestamp (Graph types it `float`); we hand
     * callers an ISO string so it crosses the API like every other timestamp we return.
     * Fail-soft with `failed: true` for the same reason as `getPagePosts` — a caller must
     * be able to tell "no scheduled posts" from "Graph errored", never conflate them —
     * and `truncated: true` when the edge filled the limit, because a merchant silently
     * unable to arm their 26th pending post is the same defect in a quieter form.
     *
     * Requires the same Page token; the edge additionally needs one of
     * pages_read_engagement / pages_read_user_content / pages_manage_metadata (error 283),
     * all of which our page connect already requests.
     */
    async getScheduledPosts(
        pageId: string,
        pageAccessToken: string,
        opts?: { limit?: number },
    ): Promise<{ posts: Array<{ id: string; message: string | null; imageUrl: string | null; scheduledPublishTime: string | null }>; failed: boolean; truncated: boolean; error?: FacebookApiError }> {
        const limit = opts?.limit ?? SCHEDULED_POSTS_MAX;
        try {
            const response = await traced('getScheduledPosts', () =>
                fbAxios.get(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(pageId)}/scheduled_posts`, {
                    params: {
                        fields: 'id,message,full_picture,scheduled_publish_time',
                        limit,
                        access_token: pageAccessToken,
                    },
                }),
            );
            const data = (response.data?.data ?? []) as Array<Record<string, unknown>>;
            const posts = data.map((p) => ({
                id: String(p.id),
                message: (p.message as string) || null,
                imageUrl: (p.full_picture as string) || null,
                scheduledPublishTime: unixToIso(p.scheduled_publish_time),
            }));
            return { posts, failed: false, truncated: data.length >= limit };
        } catch (error) {
            const detail = axios.isAxiosError(error)
                ? error.response?.data?.error?.message || error.message
                : String(error);
            this.logger.error('[Facebook] Error listing scheduled posts', { pageId, error: detail });
            // Sentry too: the caller degrades to "no scheduled posts", so without this a
            // broken permission on this edge is invisible on BOTH sides — the merchant
            // sees an empty list and we see nothing at all.
            return {
                posts: [], failed: true, truncated: false,
                error: reportGraphReadFailure(error, {
                    pageId,
                    message: 'Failed to list scheduled posts',
                    fingerprint: 'fb-scheduled-posts-read-failed',
                    detail,
                }),
            };
        }
    }

    /**
     * Read one post's publish state — the server-side check behind the scheduled-post
     * arming marker. The picker tells us WHICH post the merchant tapped; whether that
     * post is scheduled is a fact we take from Graph, never from the client.
     *
     * Returns `null` when Graph could not answer (token blip, permissions, post deleted),
     * which callers must treat as "unknown" and NOT as "published" — arming still proceeds,
     * we simply don't claim to know the schedule.
     */
    async getPostSchedule(
        postId: string,
        pageAccessToken: string,
    ): Promise<{ isPublished: boolean; scheduledPublishTime: string | null } | null> {
        try {
            const response = await traced('getPostSchedule', () =>
                // Encoded: `postId` reaches here from a request body (POST /posts/ensure),
                // and a raw path segment would let it steer the call at another Graph
                // node/edge on the page's token. Same guard as likeComment above.
                fbAxios.get(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(postId)}`, {
                    params: {
                        fields: 'is_published,scheduled_publish_time',
                        access_token: pageAccessToken,
                    },
                }),
            );
            // `is_published` is documented as always true for instantly-published and user
            // posts, so a missing field means published — only a scheduled post says false.
            return {
                isPublished: response.data?.is_published !== false,
                scheduledPublishTime: unixToIso(response.data?.scheduled_publish_time),
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] Error reading post schedule', {
                    postId,
                    error: error.response?.data?.error?.message || error.message,
                });
            }
            return null;
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
                    // Replay-safe POST: subscribing an already-subscribed page is a no-op
                    // (pages.ts re-subscribes on every sync for exactly that reason). Losing
                    // this write leaves the page connected but silently webhook-less, so it
                    // must keep its transport retry on ambiguous failures.
                    semanticallyIdempotent: true,
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
                            // Replay-safe: same converging write as above.
                            semanticallyIdempotent: true,
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
