import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { enqueueComment, enqueueMessage } from '../lib/replyQueue';
import { messagesService } from '../services/messages';
import { pagesService, isPageDisconnected, invalidateWorkspaceStatsCache } from '../services/pages';
import { publishSSEEvent } from '../lib/eventBus';
import { postsService } from '../services/posts';
import { facebookService } from '../services/facebook';
import * as typingIndicator from '../services/reply/typingIndicator';
import { acquireMutex } from '../lib/redisMutex';
import { parseReadMorePayload } from '@jawab24/shared';
import { authService } from '../services/auth';
import { auditLog } from '../services/auditLog';
import { purgeCustomerData } from '../services/gdprCustomerDeletion';
import { captureError } from '../utils/sentryHelpers';
import * as Sentry from '@sentry/node';
import { handleNonTextMessage, handleWhatsAppNonTextMessage } from '../services/reply/nonTextHandler';
import { whatsappService } from '../services/whatsapp';
import {
    classifyEcho, APP_AUTO_WINDOW_MS, APP_AUTO_INACTIVITY_DAYS, ECHO_RECENCY_RETRY_MS,
    type EchoAuthorship,
} from '../services/whatsappEchoClassifier';
import { isSharedPostType } from '../utils/instagram';
import { Logger, noopLogger, createRequestLogger } from '../types';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { redis } from '../lib/redis';

/**
 * Verify Facebook/Instagram webhook signature using X-Hub-Signature-256 header.
 * Returns true if the signature is valid, false otherwise.
 */
function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) {
        return false;
    }

    const [algorithm, signature] = signatureHeader.split('=');
    if (algorithm !== 'sha256' || !signature) {
        return false;
    }

    const expectedSignature = crypto
        .createHmac('sha256', config.facebook.appSecret)
        .update(rawBody)
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
    );
}

/** Messaging event from Facebook/Instagram webhook */
interface MessagingEvent {
    sender?: { id: string };
    /** Epoch millis when the platform (FB/IG) reports the customer sent the message.
     *  We persist this as `created_time` and order the chat by it, so an image that
     *  takes longer to process than a text follow-up still appears in send order
     *  instead of DB-insert order. */
    timestamp?: number;
    message?: {
        mid: string;
        text?: string;
        is_echo?: boolean;
        attachments?: Array<{
            type: 'audio' | 'image' | 'video' | 'file' | 'fallback' | 'post' | 'ig_post' | 'reel' | 'ig_reel' | 'sticker';
            payload?: { url?: string; title?: string; id?: string };
        }>;
    };
    /** Button tap (e.g. the Post Reply «Read more» button). No `message`; carries the payload. */
    postback?: {
        title?: string;
        payload?: string;
        mid?: string;
    };
}

interface WebhookEntry {
    id: string;
    time: number;
    messaging?: MessagingEvent[];
    changes?: WebhookChange[];
}

interface WhatsAppWebhookEntry {
    id: string;
    changes: Array<{
        field: string;
        value: {
            messaging_product: string;
            metadata: { phone_number_id: string; display_phone_number: string };
            contacts?: Array<{ profile: { name: string }; wa_id: string }>;
            messages?: Array<{
                id: string;
                from: string;
                timestamp: string;
                type: string;
                text?: { body: string };
                audio?: { id: string; mime_type?: string; voice?: boolean };
                image?: { id: string; mime_type?: string; caption?: string };
                video?: { id: string; mime_type?: string; caption?: string };
                document?: { id: string; mime_type?: string; caption?: string; filename?: string };
                sticker?: { id: string; mime_type?: string };
                button?: { text?: string };
                interactive?: {
                    button_reply?: { title?: string };
                    list_reply?: { title?: string };
                };
            }>;
            statuses?: Array<unknown>;
            // Coexistence: messages the WhatsApp Business app (or a companion
            // device) sent on a number that is ALSO on Cloud API. Meta does NOT echo
            // our own Cloud API sends here — but it DOES echo the app's own
            // automations (greeting / away message) exactly like a typed reply, and
            // carries no author field to tell them apart. Authorship is inferred by
            // whatsappEchoClassifier. `to` is the customer; `from` is the business.
            message_echoes?: Array<{
                id: string;
                from: string;
                to: string;
                timestamp: string;
                type: string;
                text?: { body: string };
                image?: { caption?: string };
                video?: { caption?: string };
                document?: { caption?: string; filename?: string };
            }>;
        };
    }>;
}

interface WebhookChange {
    field: string;
    value: {
        item?: string;
        verb?: string;
        comment_id?: string;
        post_id?: string;
        parent_id?: string;
        message?: string;
        /** Facebook Graph: structured record of each user/page tag in the message.
         *  Present even when the tag renders without an `@` prefix. Instagram does
         *  not deliver this field. See `utils/commentText.ts#FacebookMessageTag`. */
        message_tags?: import('../utils/commentText').FacebookMessageTag[];
        from?: {
            id: string;
            name?: string;
            username?: string;
        };
        created_time?: number;
        // Instagram specific fields
        id?: string;
        text?: string;
        media?: {
            id: string;
        };
    };
}

interface WebhookBody {
    object: string;
    entry: WebhookEntry[];
}

/**
 * Limits how many processWebhookAsync / processInstagramWebhookAsync calls
 * run concurrently. Without this, a burst of webhook requests from a newly
 * connected page can spawn dozens of goroutines that exhaust the DB connection pool.
 */
const MAX_CONCURRENT_WEBHOOK_PROCESSING = 10;

/**
 * Resolve the effective attachment type from a Facebook/Instagram attachment object.
 * The Like button (👍) arrives as type="image" with sticker_id in the payload —
 * normalise it to "sticker" so nonTextHandler silently ignores it.
 */
function resolveAttachmentType(att: { type: string; payload?: Record<string, unknown> }): string {
    return att.payload?.sticker_id !== undefined && att.payload.sticker_id !== null ? 'sticker' : att.type;
}
let activeWebhookProcessors = 0;

export class WebhookController {
    private logger: Logger = noopLogger;
    private requestId: string | undefined;

    /** Set logger for the current request context */
    private setLogger(request: FastifyRequest): void {
        this.logger = createRequestLogger(request.log);
        // Extract request ID from headers (set by requestId middleware)
        this.requestId = request.headers['x-request-id'] as string | undefined;
    }

    /** Get logger */
    private log(): Logger {
        return this.logger;
    }

    /**
     * Try to acquire a concurrency slot for async webhook processing.
     * Returns true and increments the counter on success.
     * Returns false and sends 503 on failure — Facebook will retry with backoff,
     * so no messages are permanently lost (unlike returning 200 for dropped batches).
     */
    private acquireWebhookSlot(reply: FastifyReply): boolean {
        if (activeWebhookProcessors >= MAX_CONCURRENT_WEBHOOK_PROCESSING) {
            this.log().warn('Webhook concurrency limit reached — asking Facebook to retry', {
                active: activeWebhookProcessors,
                limit: MAX_CONCURRENT_WEBHOOK_PROCESSING,
            });
            Sentry.captureMessage('Webhook concurrency limit reached', {
                level: 'warning',
                extra: { active: activeWebhookProcessors, limit: MAX_CONCURRENT_WEBHOOK_PROCESSING },
            });
            reply.status(503).send('OVERLOADED');
            return false;
        }
        activeWebhookProcessors++;
        return true;
    }

    /**
     * Verify webhook token (Facebook challenge)
     * GET /webhook
     */
    async verifyWebhook(request: FastifyRequest<{ Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string } }>, reply: FastifyReply) {
        this.setLogger(request);
        const mode = request.query['hub.mode'];
        const token = request.query['hub.verify_token'];
        const challenge = request.query['hub.challenge'];

        if (mode && token) {
            if (mode === 'subscribe' && token === config.facebook.webhookVerifyToken) {
                this.log().info('Webhook verified successfully');
                return reply.status(200).send(challenge);
            } else {
                return reply.status(403).send('Verification token mismatch');
            }
        }
        return reply.status(400).send('Missing parameters');
    }

    /**
     * Handle webhook events
     * POST /webhook
     */
    async handleWebhook(request: FastifyRequest, reply: FastifyReply) {
        this.setLogger(request);

        // Verify webhook signature from Facebook/Instagram
        const rawBody = request.rawBody;
        const signatureHeader = request.headers['x-hub-signature-256'] as string | undefined;

        if (!rawBody || !verifyWebhookSignature(rawBody, signatureHeader)) {
            this.log().warn('Webhook signature verification failed', {
                hasRawBody: !!rawBody,
                hasSignature: !!signatureHeader,
            });
            return reply.status(403).send('Invalid signature');
        }

        const body = request.body as WebhookBody;

        // Guard against malformed payloads (Facebook occasionally sends unexpected shapes)
        if (!body || typeof body.object !== 'string' || !Array.isArray(body.entry)) {
            this.log().warn('Malformed webhook body — missing object or entry array', {
                hasBody: !!body,
                objectType: typeof body?.object,
                entryType: typeof body?.entry,
            });
            return reply.status(400).send('Invalid payload');
        }

        // Log the webhook for debugging (only in debug level)
        this.log().debug('Received webhook', { object: body.object, entryCount: body.entry.length });

        if (body.object === 'page') {
            if (!this.acquireWebhookSlot(reply)) return;
            this.processWebhookAsync(body.entry)
                .catch(err => this.log().error('Error processing Facebook webhook', { error: String(err) }))
                .finally(() => { activeWebhookProcessors--; });
            return reply.status(200).send('EVENT_RECEIVED');
        } else if (body.object === 'instagram') {
            if (!this.acquireWebhookSlot(reply)) return;
            this.processInstagramWebhookAsync(body.entry)
                .catch(err => this.log().error('Error processing Instagram webhook', { error: String(err) }))
                .finally(() => { activeWebhookProcessors--; });
            return reply.status(200).send('EVENT_RECEIVED');
        } else if (body.object === 'whatsapp_business_account') {
            if (!this.acquireWebhookSlot(reply)) return;
            this.processWhatsAppWebhookAsync(body.entry as unknown as WhatsAppWebhookEntry[])
                .catch(err => this.log().error('Error processing WhatsApp webhook', { error: String(err) }))
                .finally(() => { activeWebhookProcessors--; });
            return reply.status(200).send('EVENT_RECEIVED');
        } else {
            // Return a '404 Not Found' if event is not from a known subscription
            this.log().info('Unknown webhook object type', { objectType: body.object });
            return reply.status(404).send();
        }
    }

    /**
     * Process webhook entries asynchronously
     */
    private async processWebhookAsync(entries: WebhookEntry[]) {
        for (const entry of entries) {
            const pageId = entry.id;

            // Fetch page once per entry — reused for all messages/changes in this batch
            const page = await pagesService.getPageByFacebookId(pageId);
            if (!page) {
                this.log().debug('Skipping webhook for unknown page', { pageId });
                continue;
            }
            if (isPageDisconnected(page)) {
                this.log().warn('Skipping webhook for disconnected page', { pageId, pageName: page.name });
                continue;
            }

            // Handle feed changes (comments, posts)
            if (entry.changes) {
                const publishedPostIds: string[] = [];
                for (const change of entry.changes) {
                    const publishedPostId = await this.processChange(pageId, change);
                    if (publishedPostId) publishedPostIds.push(publishedPostId);
                }
                // Scheduled-marker reconciliation runs AFTER every comment in the batch is
                // enqueued. It is diagnostic work that now makes bounded Graph reads, and
                // no customer's reply should queue behind it.
                for (const publishedPostId of publishedPostIds) {
                    await this.reconcileScheduledArmedMarker(page, publishedPostId);
                }
            }

            // Handle messaging events
            if (entry.messaging) {
                for (const messageEvent of entry.messaging) {
                    // Skip echo events (bot's own messages reflected back)
                    if (messageEvent.message?.is_echo) continue;
                    // Handle text messages through the normal pipeline
                    if (messageEvent.message && messageEvent.message.text) {
                        // Check for attached shared post/reel (text + post combo)
                        const postAtt = messageEvent.message.attachments?.find(
                            a => isSharedPostType(a.type),
                        );
                        await this.processMessage(pageId, messageEvent, page, postAtt?.payload?.url, postAtt?.payload?.id);
                    } else if (messageEvent.message?.attachments?.length) {
                        const att = messageEvent.message.attachments[0];
                        if (messageEvent.sender?.id && messageEvent.message.mid) {
                            await handleNonTextMessage(pageId, {
                                senderId: messageEvent.sender.id,
                                messageId: messageEvent.message.mid,
                                attachmentType: resolveAttachmentType(att),
                                attachmentUrl: att.payload?.url,
                                attachmentId: att.payload?.id,
                                attachmentTitle: att.payload?.title,
                                platformTimestamp: messageEvent.timestamp,
                            }, 'facebook', this.log());
                        }
                    } else if (messageEvent.postback) {
                        // Button tap (Post Reply «Read more») — deliver the full text in-chat.
                        await this.processPostback(page, messageEvent);
                    }
                }
            }
        }
    }

    /**
     * Process a messaging event - store immediately and enqueue for async reply
     */
    private async processMessage(pageId: string, event: MessagingEvent, page: Awaited<ReturnType<typeof pagesService.getPageByFacebookId>>, sharedPostUrl?: string, sharedPostId?: string) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;
        const messageId = event.message?.mid;

        if (!senderId || !messageText || !messageId) {
            return;
        }

        // Guard: page.workspaceId is nullable in schema but pages connected since 0073_backfill
        // always have it. Legacy null-workspace pages were orphans that should have been
        // cleaned up — skip rather than write a partially-denormalized row.
        if (!page.workspaceId) {
            this.log().warn('Page missing workspace_id — skipping message store', { pageId: page.id, messageId });
            return;
        }

        this.log().info('Enqueueing message for processing', {
            senderId,
            messageId,
            textLength: messageText.length
        });

        try {
            // Store message immediately so rapid follow-ups build conversation context.
            const { message: stored, isNew } = await messagesService.findOrCreateFromWebhook(
                page.id,
                page.workspaceId,
                messageId,
                senderId,
                messageText,
            );

            // Stamp FB-reported send time. Chat sorts by created_time, so this
            // guarantees in-order display even when our store path is slower
            // than a sibling event (see services/messages.ts setCreatedTime).
            if (isNew && typeof event.timestamp === 'number') {
                await messagesService.setCreatedTime(stored.id, new Date(event.timestamp));
            }

            // "typing…" the instant the message lands, mirroring WhatsApp (see the
            // markAsRead({ typing: true }) call in the WhatsApp branch).
            //
            // This used to fire deep in the reply pipeline instead, AFTER the merchant's
            // reply delay (settings.replyDelay, 0-60s) — so on Messenger the
            // customer stared at dead air for the whole delay and only saw "typing…" in
            // the last moment before the reply. That is the bug this fixes; WhatsApp never
            // had it because it claims the indicator here, at receipt.
            //
            // Gated on autoReplyEnabled: showing "typing…" when no reply will follow is a
            // lie. Fire-and-forget — a cosmetic Graph call must never delay the enqueue,
            // and the reply pipeline reads Redis (typingIndicator.wasShown) rather than a
            // return value. Known limitation: Messenger auto-clears after ~20s, so a
            // replyDelay above that still ends in some silence — strictly better than
            // today's silence for the entire delay.
            if (page.autoReplyEnabled && page.accessToken) {
                void typingIndicator.showOnce(page.id, messageId, () =>
                    facebookService.sendTypingIndicator(page.accessToken, senderId),
                );
            }

            // Enqueue reply job immediately — debounce is handled by hasNewerUnrepliedMessage
            const jobId = await enqueueMessage({
                jobType: 'facebook_message',
                pageId,
                messageId,
                senderId,
                text: messageText,
                sharedPostUrl,
                sharedPostId,
                requestId: this.requestId,
            });

            this.log().info('Message enqueued successfully', { messageId, jobId });
        } catch (error) {
            this.log().error('Failed to enqueue message', {
                messageId,
                error: String(error)
            });
        }
    }

    /**
     * Process a Post Reply «Read more» button tap. The tap opened Meta's 24h messaging window,
     * so we deliver the FULL reply text as a follow-up DM (the card only showed a teaser). The
     * image is NOT re-sent — it is already in the card and tappable to full size there.
     * Everything is best-effort and must never throw — a webhook that 500s gets redelivered by Meta.
     */
    private async processPostback(
        page: Awaited<ReturnType<typeof pagesService.getPageByFacebookId>>,
        event: MessagingEvent,
    ) {
        if (!page) return;
        const psid = event.sender?.id;
        const parsed = parseReadMorePayload(event.postback?.payload);
        if (!psid || !parsed) return; // not our button / malformed payload
        if (!page.workspaceId) return; // legacy orphan page — nothing to attribute the DM to

        // Dedupe rapid double-taps / Meta redeliveries of the same tap.
        const lockKey = `postback_tap:${page.id}:${psid}:${event.postback?.mid ?? parsed.postId}`;
        const lock = await acquireMutex(lockKey, 10);
        if (!lock) return;

        try {
            const post = await postsService.getPost(parsed.postId, page.workspaceId);
            if (!post?.triggerReply) {
                this.log().warn('[Postback] read-more: post or trigger not found', { pageId: page.id, postId: parsed.postId });
                return;
            }
            const token = page.accessToken;
            await facebookService.sendTypingIndicator(token, psid).catch(() => { /* cosmetic */ });

            // Deliver the full TEXT only. The image is already shown in the card (and tappable to
            // full-size there), so re-sending it here would duplicate it.
            await facebookService.sendPrivateMessage(token, psid, post.triggerReply);

            // Do NOT store an inbox row here: the comment→DM card send already persisted this exact
            // reply as an outgoing `post_reply` message (commentProcessor.sendAndFinalize). Storing
            // again on the tap would show the merchant the same reply twice. Engagement is tracked
            // via the tap metric below instead.
            redis.incr('metrics:postreply:readmore_tap').catch(() => { /* metrics never block */ });
        } catch (err) {
            captureError(err, 'processPostback failed', {
                tags: { component: 'webhook-postback' },
                extra: { pageId: page.id, postId: parsed.postId },
            });
        }
    }

    /**
     * Process a single change event
     */
    private async processChange(pageId: string, change: WebhookChange): Promise<string | undefined> {
        this.log().info('Processing change', {
            field: change.field,
            item: change.value.item,
            verb: change.value.verb,
            pageId,
        });

        // Only process feed changes
        if (change.field !== 'feed') {
            this.log().info('Skipping non-feed change', { field: change.field, pageId });
            return;
        }

        const { value } = change;

        // Only process new comments (not edits or deletes)
        if (value.item === 'comment' && value.verb === 'add') {
            await this.processNewComment(pageId, value);
        } else if (value.item === 'post' && value.verb === 'add') {
            this.log().info('New post detected', { postId: value.post_id });
            // Post rows themselves are still created lazily when comments come in. The only
            // work owed here is retiring the scheduled-post arming marker for a post that
            // just went live — returned rather than done inline, so the caller can run it
            // after this batch's comments are enqueued (see processWebhookAsync).
            return value.post_id;
        } else {
            this.log().info('Skipping feed change', { item: value.item, verb: value.verb, pageId });
        }
    }

    /**
     * A post went live: retire the scheduled-post arming marker for it, heal markers whose
     * own publish webhook we missed, and surface the id-drift tripwire for a post Graph
     * still reports as pending past its time (see `postsService.onPostPublished`).
     *
     * Never throws — a marker we failed to reconcile must not cost us the rest of the
     * webhook batch, and the marker is diagnostic, not a gate.
     */
    private async reconcileScheduledArmedMarker(
        page: NonNullable<Awaited<ReturnType<typeof pagesService.getPageByFacebookId>>>,
        facebookPostId: string,
    ) {
        try {
            const { cleared, orphanedPostIds, healedPostIds } = await postsService.onPostPublished(
                page.id,
                facebookPostId,
                // The token lets the service ask Graph whether an overdue marker is really
                // drift or just a webhook we never got; the workspace lets it tell the
                // merchant, who is the only one who can re-arm the post.
                { accessToken: page.accessToken, workspaceId: page.workspaceId, pageName: page.name },
            );
            if (cleared || orphanedPostIds.length > 0 || healedPostIds.length > 0) {
                this.log().info('Scheduled Post Reply marker reconciled on publish', {
                    pageId: page.id,
                    facebookPostId,
                    cleared,
                    orphanedCount: orphanedPostIds.length,
                    healedCount: healedPostIds.length,
                });
            }
        } catch (err) {
            captureError(err, 'Failed to reconcile scheduled Post Reply marker', {
                level: 'warning',
                tags: { component: 'webhook-post-published' },
                extra: { pageId: page.id, facebookPostId },
            });
        }
    }

    /**
     * Process a new comment - enqueue for async processing
     */
    private async processNewComment(pageId: string, value: WebhookChange['value']) {
        const { comment_id, post_id, message, from, parent_id, message_tags } = value;

        if (!comment_id || !post_id || !message) {
            this.log().info('Missing required fields for comment processing', {
                comment_id,
                post_id,
                hasMessage: !!message,
                fromId: from?.id,
            });
            return;
        }

        // Don't reply to our own comments (page's comments)
        if (from?.id === pageId) {
            this.log().info('Skipping own page comment', { comment_id, fromId: from?.id, pageId });
            return;
        }

        this.log().info('Enqueueing comment for processing', { comment_id, post_id });

        try {
            const jobId = await enqueueComment({
                jobType: 'facebook_comment',
                pageId,
                postId: post_id,
                commentId: comment_id,
                parentId: parent_id,
                text: message,
                senderId: from?.id,
                senderName: from?.name,
                messageTags: message_tags,
                requestId: this.requestId,
            });

            this.log().info('Comment enqueued successfully', { comment_id, jobId });
        } catch (error) {
            this.log().error('Failed to enqueue comment', { 
                comment_id, 
                error: String(error) 
            });
        }
    }

    // ================== Instagram Webhook Handlers ==================

    /**
     * Process Instagram webhook entries asynchronously
     */
    private async processInstagramWebhookAsync(entries: WebhookEntry[]) {
        for (const entry of entries) {
            const instagramAccountId = entry.id;

            // Skip if page access was revoked (empty accessToken)
            const page = await pagesService.getPageByInstagramId(instagramAccountId);
            if (isPageDisconnected(page)) {
                this.log().warn('Skipping Instagram webhook for disconnected page', { instagramAccountId, pageName: page.name });
                continue;
            }

            // Handle Instagram changes (comments, mentions)
            if (entry.changes) {
                for (const change of entry.changes) {
                    await this.processInstagramChange(instagramAccountId, change);
                }
            }

            // Handle Instagram messaging events (DMs)
            if (entry.messaging) {
                for (const messageEvent of entry.messaging) {
                    // Skip echo events (bot's own messages reflected back)
                    if (messageEvent.message?.is_echo) continue;
                    if (messageEvent.message && messageEvent.message.text) {
                        // Check for attached shared post/reel (text + post combo)
                        const postAtt = messageEvent.message.attachments?.find(
                            a => isSharedPostType(a.type),
                        );
                        await this.processInstagramMessage(instagramAccountId, messageEvent, postAtt?.payload?.url, postAtt?.payload?.id);
                    } else if (messageEvent.message?.attachments?.length) {
                        const att = messageEvent.message.attachments[0];
                        if (messageEvent.sender?.id && messageEvent.message.mid) {
                            await handleNonTextMessage(instagramAccountId, {
                                senderId: messageEvent.sender.id,
                                messageId: messageEvent.message.mid,
                                attachmentType: resolveAttachmentType(att),
                                attachmentUrl: att.payload?.url,
                                attachmentId: att.payload?.id,
                                attachmentTitle: att.payload?.title,
                                platformTimestamp: messageEvent.timestamp,
                            }, 'instagram', this.log());
                        }
                    }
                }
            }
        }
    }

    /**
     * Process an Instagram change event
     */
    private async processInstagramChange(instagramAccountId: string, change: WebhookChange) {
        this.log().debug('[Instagram] Processing change', { field: change.field });

        // Handle comments on Instagram media
        if (change.field === 'comments') {
            await this.processInstagramComment(instagramAccountId, change.value);
        }

        // Handle mentions — not supported yet. Count the drops (fire-and-forget,
        // same contract as aiMetrics) so the decision to build support can be
        // made from real volume instead of a silent gap.
        if (change.field === 'mentions') {
            redis.incr('metrics:instagram:mentions_dropped').catch(() => {});
            this.log().debug('[Instagram] Mention received - not processing for now');
        }
    }

    /**
     * Process an Instagram comment - enqueue for async processing
     */
    private async processInstagramComment(instagramAccountId: string, value: WebhookChange['value']) {
        const commentId = value.id;
        const commentText = value.text;
        const mediaId = value.media?.id;
        const from = value.from;

        if (!commentId || !commentText || !mediaId) {
            this.log().debug('[Instagram] Missing required fields for comment processing', { 
                commentId, 
                mediaId, 
                hasText: !!commentText 
            });
            return;
        }

        // Don't reply to our own comments
        if (from?.id === instagramAccountId) {
            this.log().debug('[Instagram] Skipping own comment', { commentId });
            return;
        }

        this.log().info('[Instagram] Enqueueing comment for processing', { commentId, mediaId });

        try {
            const jobId = await enqueueComment({
                jobType: 'instagram_comment',
                pageId: instagramAccountId,
                postId: mediaId,
                commentId,
                text: commentText,
                senderId: from?.id,
                senderName: from?.username,
                requestId: this.requestId,
            });

            this.log().info('[Instagram] Comment enqueued successfully', { commentId, jobId });
        } catch (error) {
            this.log().error('[Instagram] Failed to enqueue comment', { 
                commentId, 
                error: String(error) 
            });
        }
    }

    /**
     * Process an Instagram DM - enqueue for async processing
     */
    private async processInstagramMessage(instagramAccountId: string, event: MessagingEvent, sharedPostUrl?: string, sharedPostId?: string) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;
        const messageId = event.message?.mid;

        if (!senderId || !messageText || !messageId) {
            return;
        }

        this.log().info('[Instagram] Enqueueing message for processing', {
            senderId,
            messageId,
            textLength: messageText.length
        });

        try {
            const jobId = await enqueueMessage({
                jobType: 'instagram_message',
                pageId: instagramAccountId,
                messageId,
                senderId,
                text: messageText,
                sharedPostUrl,
                sharedPostId,
                requestId: this.requestId,
            });

            this.log().info('[Instagram] Message enqueued successfully', { messageId, jobId });
        } catch (error) {
            this.log().error('[Instagram] Failed to enqueue message', { 
                messageId, 
                error: String(error) 
            });
        }
    }

    // ================== WhatsApp Webhook Processing ==================

    /**
     * Process WhatsApp webhook entries asynchronously
     */
    private async processWhatsAppWebhookAsync(entries: WhatsAppWebhookEntry[]) {
        for (const entry of entries) {
            for (const change of entry.changes) {
                // Coexistence fields. Subscribing to all three is required by Meta
                // for WhatsApp-Business-app onboarding to be valid, but only the
                // echo is acted on in v1.
                if (change.field === 'smb_message_echoes') {
                    await this.processWhatsAppEchoes(change.value).catch(error => {
                        // Never let an echo failure abort the loop — a later change
                        // in the same delivery may be a real customer message.
                        this.log().error('[WhatsApp] Failed to process message echoes', {
                            error: String(error),
                        });
                    });
                    continue;
                }
                // `history` (up to 180 days, potentially thousands of messages) and
                // `smb_app_state_sync` (contacts) are deliberately ACCEPTED AND
                // DISCARDED in v1 — we return 200 so onboarding stays valid without
                // importing anyone's back-catalogue into the inbox. Logged at debug
                // so we can see they arrive before deciding to persist them.
                if (change.field === 'history' || change.field === 'smb_app_state_sync') {
                    // INFO, not debug: Meta's onboarding docs warn that partners
                    // have 24h to "synchronize" history or the merchant must
                    // offboard and restart, and whether receiving-and-discarding
                    // satisfies that is UNVERIFIED. We cannot answer it from
                    // production if the evidence is below the log level. Revisit
                    // once a real coexistence number has connected.
                    this.log().info('[WhatsApp] Coexistence sync webhook received (accepted, not persisted)', {
                        field: change.field,
                        phoneNumberId: change.value?.metadata?.phone_number_id,
                    });
                    continue;
                }
                if (change.field !== 'messages') continue;

                const { metadata, messages: waMessages, contacts, statuses } = change.value;
                const phoneNumberId = metadata.phone_number_id;

                // Skip status callbacks (delivered/read receipts) — phase 1
                if (statuses && !waMessages) continue;
                if (!waMessages) continue;

                // Build name lookup from contacts array
                const contactNames = new Map<string, string>();
                for (const c of contacts || []) {
                    if (c.profile?.name) contactNames.set(c.wa_id, c.profile.name);
                }

                // One page fetch per change: read receipts need the WABA token at
                // receipt time (the worker refetches later for the reply). Receipts
                // are skipped — never failed — when the page is missing or auto-reply
                // is off, since no reply will follow and a "typing…" would lie.
                const waPage = await pagesService.getPageByWhatsAppPhoneNumberId(phoneNumberId)
                    .catch(() => null);
                const receiptToken = (waPage?.whatsappAutoReplyEnabled && waPage.whatsappAccessToken)
                    ? waPage.whatsappAccessToken
                    : null;

                for (const msg of waMessages) {
                    const senderName = contactNames.get(msg.from);

                    // Anything that carries customer-authored text goes straight to the
                    // AI pipeline: plain text, quick-reply buttons, list/button replies,
                    // and media captions (marked so the AI knows an attachment came with it).
                    const textBody = this.extractWhatsAppText(msg);
                    if (textBody) {
                        // Blue ticks + "typing…" the instant the message lands. The reply
                        // takes a few seconds (deliberate reply delay + AI generation) and
                        // without this the wait reads as dead air — Messenger shows typing
                        // for the same window (founder pilot feedback, 2026-07-08).
                        if (receiptToken) {
                            void this.logReceiptMiss(
                                whatsappService.markAsRead(phoneNumberId, msg.id, receiptToken, { typing: true }),
                                msg.id, true,
                            );
                        }
                        try {
                            const jobId = await enqueueMessage({
                                jobType: 'whatsapp_message',
                                pageId: phoneNumberId,
                                messageId: msg.id,
                                senderId: msg.from,
                                text: textBody,
                                senderName,
                                requestId: this.requestId,
                            });

                            this.log().info('[WhatsApp] Message enqueued', { messageId: msg.id, jobId });
                        } catch (error) {
                            this.log().error('[WhatsApp] Failed to enqueue message', {
                                messageId: msg.id, error: String(error),
                            });
                        }
                        continue;
                    }

                    // Caption-less media: voice notes get transcribed into the AI
                    // pipeline; other attachments store a placeholder + text-only nudge.
                    const media = msg.audio ?? msg.image ?? msg.video ?? msg.document ?? msg.sticker;
                    if (media) {
                        // Read receipt for media too; typing only when a reply follows —
                        // stickers are stored silently, so typing there would mislead.
                        if (receiptToken) {
                            void this.logReceiptMiss(
                                whatsappService.markAsRead(phoneNumberId, msg.id, receiptToken, { typing: msg.type !== 'sticker' }),
                                msg.id, msg.type !== 'sticker',
                            );
                        }
                        await handleWhatsAppNonTextMessage(phoneNumberId, {
                            senderId: msg.from,
                            messageId: msg.id,
                            attachmentType: msg.type,
                            mediaId: media.id,
                            mimeType: media.mime_type,
                            senderName,
                            platformTimestamp: Number(msg.timestamp) * 1000 || undefined,
                        }, this.log());
                        continue;
                    }

                    // location / contacts / reaction / order / unsupported — no reply path yet
                    this.log().debug('[WhatsApp] Skipping unsupported message type', {
                        messageId: msg.id, type: msg.type,
                    });
                }
            }
        }
    }

    /**
     * WhatsApp Coexistence — something was sent from the merchant's phone.
     *
     * On a coexistence number the merchant keeps using the WhatsApp Business app
     * while we also hold the number on Cloud API, so both a human and the AI can
     * answer the same customer. Meta reports everything the app sends via
     * `smb_message_echoes` — our own Cloud API replies are never echoed back.
     *
     * Two kinds of echo arrive on the same field, with no author flag (D-109):
     *   - the merchant TYPED a reply → stored `replyMethod='manual'`, which is
     *     what the handoff pause (`conversationPause._getRecentManualReply`) keys
     *     on, and the customer's pending backlog is marked answered;
     *   - the APP sent its own greeting / away message → stored `'app_auto'`: no
     *     pause, backlog untouched, so the AI still answers the customer. Read as
     *     a handoff, the greeting silenced Jawab24 for the whole pause window in
     *     every conversation of the first real coexistence merchant (2026-08-29).
     * Authorship comes from `classifyEcho` on the customer's inbound recency.
     */
    private async processWhatsAppEchoes(
        value: WhatsAppWebhookEntry['changes'][number]['value'],
    ): Promise<void> {
        const echoes = value.message_echoes;
        if (!echoes?.length) return;

        const phoneNumberId = value.metadata.phone_number_id;
        const page = await pagesService.getPageByWhatsAppPhoneNumberId(phoneNumberId).catch(() => null);
        // Unknown number (disconnected, or moved to another workspace) — nothing to
        // attach the reply to. Dropping is correct; Meta still gets its 200.
        if (!page) {
            this.log().warn('[WhatsApp] Echo for an unknown phone number', { phoneNumberId });
            return;
        }
        // Every message row is workspace-scoped. A page without one cannot be
        // written to safely, and silently attributing it elsewhere would leak the
        // conversation across tenants — drop instead.
        const { workspaceId } = page;
        if (!workspaceId) {
            this.log().warn('[WhatsApp] Echo for a page with no workspace', { phoneNumberId, pageId: page.id });
            return;
        }

        for (const echo of echoes) {
            // `to` is the customer. Conversations are keyed by the customer's id,
            // so without it the row has nowhere to live.
            const customerId = echo.to;
            if (!customerId || !echo.id) continue;

            // Idempotency + self-send guard in one lookup. The UNIQUE constraint on
            // platform_message_id is the authoritative race guard behind it, the
            // same pattern findOrCreateFromWebhook uses.
            const existing = await messagesService.findByPlatformMessageId(echo.id);
            if (existing) continue;

            const text = this.extractEchoText(echo);
            const epochSeconds = Number(echo.timestamp);
            const echoSentAt = Number.isFinite(epochSeconds) && epochSeconds > 0
                ? new Date(epochSeconds * 1000).toISOString()
                : null;
            const { method, inputs } = await this.classifyEchoAuthorship(page.id, customerId);
            // Recording the merchant's reply and clearing the customer's backlog
            // are ONE fact: "a human has answered this conversation". Split across
            // two commits, a failure in between leaves the reply stored while the
            // customer's message still reads unanswered — and the AI then answers
            // a question a human already handled. Same transaction shape the AI
            // reply path uses in messageProcessor. An app automation answers
            // nothing, so for `app_auto` the backlog is deliberately left pending.
            let stored: { id: string; senderName?: string | null };
            let cleared = 0;
            try {
                ({ stored, cleared } = await db.transaction(async (tx) => {
                    const row = await messagesService.storeOutgoingMessage(
                        page.id, workspaceId, customerId, text, method, tx,
                        undefined, undefined, undefined, undefined, echo.id, 'whatsapp',
                    );
                    if (method !== 'manual') return { stored: row, cleared: 0 };
                    // storeOutgoingMessage is a pure INSERT and never touches the
                    // incoming row, so without this the customer's question sits in
                    // "Needs Action" forever even though it was answered.
                    const unreplied = await messagesService.getUnrepliedFromSender(page.id, customerId);
                    const n = unreplied.length > 0
                        ? await messagesService.markOlderMessagesAsReplied(
                            page.id, customerId, unreplied.map(m => m.id), '', text, 'manual', tx,
                        )
                        : 0;
                    return { stored: row, cleared: n };
                }));
            } catch (error) {
                // Concurrent delivery of the same echo lost the unique-constraint
                // race. Already recorded by the winner — not an error. The whole
                // transaction rolled back, so nothing partial was left behind.
                this.log().debug('[WhatsApp] Echo already stored (race)', { messageId: echo.id, error: String(error) });
                continue;
            }

            // Live inbox. Unlike a customer message, an echo never reaches the
            // reply worker — which is where every other path emits its SSE — so
            // without this the merchant's own phone reply only appears on a
            // refresh, and the "Needs Action" count we just cleared stays stale.
            if (page.userId) {
                publishSSEEvent(page.userId, 'message:received', {
                    messageId: echo.id,
                    pageId: page.id,
                    senderId: customerId,
                    // storeOutgoingMessage resolves the name off the conversation;
                    // reusing it keeps the live row from rendering nameless and then
                    // correcting itself on the next refresh.
                    senderName: stored.senderName ?? null,
                    message: {
                        id: stored.id,
                        pageId: page.id,
                        platformMessageId: echo.id,
                        senderId: customerId,
                        senderName: stored.senderName ?? null,
                        message: text,
                        direction: 'outgoing' as const,
                        replied: true,
                        replyText: text,
                        replyMethod: method,
                        // Meta's own send time (epoch seconds), not ours — an echo
                        // can arrive late, and ordering the thread by our clock
                        // would sort it after messages that really came later.
                        createdTime: echoSentAt,
                        repliedAt: echoSentAt ?? new Date().toISOString(),
                        createdAt: new Date().toISOString(),
                    },
                });
                invalidateWorkspaceStatsCache(workspaceId);
            }

            // One stable event per echo, with the classifier's inputs, so the
            // verdict is auditable from the log alone (and a misread is diagnosable
            // without re-deriving the timing from the messages table).
            this.log().info(
                method === 'manual'
                    ? '[WhatsApp] whatsapp_echo_classified: merchant replied from their phone — AI will stand down'
                    : '[WhatsApp] whatsapp_echo_classified: app automation echoed — AI keeps answering',
                { messageId: echo.id, method, cleared, ...inputs },
            );
        }
    }

    /**
     * Human or app? See whatsappEchoClassifier.ts for the rule and its evidence.
     * The inbound row is written by the reply worker, not by the webhook, so on a
     * missing row we re-read once after a short delay before deciding; the
     * `retried` / `null` inputs are logged so the miss rate is measurable.
     */
    private async classifyEchoAuthorship(
        pageId: string,
        customerId: string,
    ): Promise<{ method: EchoAuthorship; inputs: { msSinceLastInbound: number | null; priorInboundBeforeWindow: boolean; retried: boolean } }> {
        const read = () => messagesService.getInboundRecency(pageId, customerId, APP_AUTO_WINDOW_MS, APP_AUTO_INACTIVITY_DAYS);
        let recency = await read();
        let retried = false;
        if (!recency.lastAt) {
            await new Promise<void>(resolve => setTimeout(resolve, ECHO_RECENCY_RETRY_MS));
            retried = true;
            recency = await read();
        }
        const msSinceLastInbound = recency.lastAt ? Date.now() - recency.lastAt.getTime() : null;
        const method = classifyEcho({ msSinceLastInbound, priorInboundBeforeWindow: recency.priorInboundBeforeWindow });
        return { method, inputs: { msSinceLastInbound, priorInboundBeforeWindow: recency.priorInboundBeforeWindow, retried } };
    }

    /**
     * Text of an echoed merchant reply. Media echoes carry only a caption (or
     * nothing) — the exact wording does not matter for the pause, what matters is
     * that a human answered, so a placeholder is enough to create the row.
     */
    private extractEchoText(
        echo: NonNullable<WhatsAppWebhookEntry['changes'][number]['value']['message_echoes']>[number],
    ): string {
        return echo.text?.body
            ?? echo.image?.caption
            ?? echo.video?.caption
            ?? echo.document?.caption
            ?? `[${echo.type}]`;
    }

    /**
     * Record a read-receipt / typing-indicator that Meta did not accept.
     *
     * Deliberately non-blocking and deliberately NOT an error: receipts are
     * cosmetic, and a failed one must never surface to the merchant or page
     * Sentry. But it must not vanish either — the previous silent catch meant
     * "the typing indicator doesn't always appear" could not be answered from
     * production at all, since a rejected call looked exactly like a delivered
     * one. `warn` keeps it greppable per phone number without adding noise to
     * the error budget.
     */
    private async logReceiptMiss(
        pending: Promise<{ delivered: boolean; reason?: string }>,
        messageId: string,
        typing: boolean,
    ): Promise<void> {
        // markAsRead resolves rather than rejects by contract, but this runs
        // un-awaited: any throw here would become an unhandled rejection and
        // could take the process down. Belt-and-braces so a cosmetic receipt can
        // never destabilise the webhook path.
        const result = await pending.catch((error: unknown) => ({
            delivered: false, reason: error instanceof Error ? error.message : String(error),
        }));
        if (!result?.delivered) {
            this.log().warn('[WhatsApp] read receipt / typing indicator not delivered', {
                messageId, typing, reason: result?.reason,
            });
        }
    }

    /**
     * Pull customer-authored text out of a WhatsApp webhook message: plain
     * text, quick-reply button taps, interactive replies, or media captions.
     * Returns null when the message carries no text (pure media → non-text path).
     */
    private extractWhatsAppText(
        msg: NonNullable<WhatsAppWebhookEntry['changes'][number]['value']['messages']>[number],
    ): string | null {
        if (msg.type === 'text' && msg.text?.body) return msg.text.body;
        if (msg.button?.text) return msg.button.text;
        const interactiveTitle = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title;
        if (interactiveTitle) return interactiveTitle;

        // Captioned media: keep the caption as the message, marked with the
        // attachment kind so the AI knows an attachment came with it.
        const captioned = msg.image ?? msg.video ?? msg.document;
        if (captioned?.caption) {
            const label = msg.type === 'image' ? 'Image' : msg.type === 'video' ? 'Video' : 'Document';
            return `[${label}] ${captioned.caption}`;
        }
        return null;
    }

    // ================== GDPR Data Deletion ==================

    /**
     * Facebook Data Deletion Callback
     * POST /webhook/data-deletion
     *
     * Required by Facebook Platform for GDPR compliance.
     * When a user requests data deletion through Facebook's Data Download
     * Center, this endpoint processes the request and returns a confirmation
     * URL and a tracking code.
     *
     * Reference: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
     */
    async handleDataDeletion(request: FastifyRequest, reply: FastifyReply) {
        this.setLogger(request);

        // Verify the signed_request (same HMAC as webhook but base64url-encoded)
        const { signed_request } = request.body as { signed_request?: string };
        if (!signed_request) {
            return reply.status(400).send({ error: 'Missing signed_request' });
        }

        const [encodedSig, encodedPayload] = signed_request.split('.');
        if (!encodedSig || !encodedPayload) {
            return reply.status(400).send({ error: 'Malformed signed_request' });
        }

        // Verify HMAC-SHA256 signature
        const expectedSig = crypto
            .createHmac('sha256', config.facebook.appSecret)
            .update(encodedPayload)
            .digest('base64url');

        // Use timingSafeEqual with equal-length buffers
        const sigBuf = Buffer.from(encodedSig, 'base64url');
        const expectedBuf = Buffer.from(expectedSig, 'base64url');
        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
            return reply.status(403).send({ error: 'Invalid signature' });
        }

        // Decode payload
        let payload: { user_id?: string };
        try {
            payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8'));
        } catch {
            return reply.status(400).send({ error: 'Invalid payload' });
        }

        const facebookUserId = payload.user_id;
        if (!facebookUserId) {
            return reply.status(400).send({ error: 'Missing user_id in payload' });
        }

        // Generate a unique confirmation code
        const confirmationCode = crypto.randomBytes(16).toString('hex');

        this.log().info('Facebook data deletion request received', { facebookUserId, confirmationCode });

        // Process deletion asynchronously (don't block the response).
        // Two independent paths — the requester may be an END CUSTOMER of a
        // merchant page (sender_id/from_id rows), a MERCHANT login account
        // (users.facebook_id), or unknown to us. Each path has its own
        // try/catch so a failure in one never skips the other.
        (async () => {
            // 1. End-customer rows (conversations, messages, leads, comments, …).
            try {
                const purge = await purgeCustomerData([facebookUserId]);
                if (purge.totalDeleted > 0) {
                    this.log().info('End-customer data purged per Facebook request', {
                        facebookUserId,
                        confirmationCode,
                        perTable: purge.perTable,
                        totalDeleted: purge.totalDeleted,
                    });
                }
            } catch (error) {
                captureError(error, 'Facebook data deletion failed (customer purge)', {
                    tags: { service: 'gdpr', source: 'facebook' },
                    extra: { facebookUserId, confirmationCode },
                });
            }

            // 2. Merchant login account.
            try {
                const [user] = await db.select({ id: users.id })
                    .from(users)
                    .where(eq(users.facebookId, facebookUserId))
                    .limit(1);

                if (user) {
                    await auditLog({
                        userId: user.id,
                        action: 'account.fb_data_deletion',
                        entityType: 'user',
                        metadata: { facebookUserId, confirmationCode },
                    });

                    await authService.deleteUser(user.id);
                    this.log().info('User data deleted per Facebook request', { userId: user.id, confirmationCode });
                } else {
                    this.log().info('No merchant account for Facebook data deletion request', { facebookUserId });
                }
            } catch (error) {
                captureError(error, 'Facebook data deletion failed (merchant account)', {
                    tags: { service: 'gdpr', source: 'facebook' },
                    extra: { facebookUserId, confirmationCode },
                });
            }
        })();

        // Return the required response format per Facebook's docs
        const statusUrl = `https://${config.shopify?.hostName || 'jawab24.com'}/gdpr/deletion-status?code=${confirmationCode}`;

        return reply.send({
            url: statusUrl,
            confirmation_code: confirmationCode,
        });
    }
}

export const webhookController = new WebhookController();
