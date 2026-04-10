import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { enqueueComment, enqueueMessage } from '../lib/replyQueue';
import { messagesService } from '../services/messages';
import { pagesService, isPageDisconnected } from '../services/pages';
import { authService } from '../services/auth';
import { auditLog } from '../services/auditLog';
import { captureError } from '../utils/sentryHelpers';
import * as Sentry from '@sentry/node';
import { handleNonTextMessage } from '../services/reply/nonTextHandler';
import { isSharedPostType } from '../utils/instagram';
import { Logger, noopLogger, createRequestLogger } from '../types';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

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
    message?: {
        mid: string;
        text?: string;
        is_echo?: boolean;
        attachments?: Array<{
            type: 'audio' | 'image' | 'video' | 'file' | 'fallback' | 'post' | 'ig_post' | 'reel' | 'ig_reel' | 'sticker';
            payload?: { url?: string; title?: string; id?: string };
        }>;
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
            }>;
            statuses?: Array<unknown>;
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

        // Log the webhook for debugging (only in debug level)
        this.log().debug('Received webhook', { object: body.object, entryCount: body.entry?.length });

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
                for (const change of entry.changes) {
                    await this.processChange(pageId, change);
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
                                attachmentType: att.type,
                                attachmentUrl: att.payload?.url,
                                attachmentId: att.payload?.id,
                                attachmentTitle: att.payload?.title,
                            }, 'facebook', this.log());
                        }
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

        this.log().info('Enqueueing message for processing', {
            senderId,
            messageId,
            textLength: messageText.length
        });

        try {
            // Store message immediately so rapid follow-ups build conversation context
            // page is guaranteed non-null — caller checks !page before calling this method
            await messagesService.findOrCreateFromWebhook(
                page.id,
                messageId,
                senderId,
                messageText
            );

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
     * Process a single change event
     */
    private async processChange(pageId: string, change: WebhookChange) {
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
            // Posts are handled when comments come in
        } else {
            this.log().info('Skipping feed change', { item: value.item, verb: value.verb, pageId });
        }
    }

    /**
     * Process a new comment - enqueue for async processing
     */
    private async processNewComment(pageId: string, value: WebhookChange['value']) {
        const { comment_id, post_id, message, from, parent_id } = value;

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
                                attachmentType: att.type,
                                attachmentUrl: att.payload?.url,
                                attachmentId: att.payload?.id,
                                attachmentTitle: att.payload?.title,
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

        // Handle mentions
        if (change.field === 'mentions') {
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

                for (const msg of waMessages) {
                    // Phase 1: only handle text messages
                    if (msg.type !== 'text' || !msg.text?.body) {
                        this.log().debug('[WhatsApp] Skipping non-text message', {
                            messageId: msg.id, type: msg.type,
                        });
                        continue;
                    }

                    const senderName = contactNames.get(msg.from);

                    try {
                        const jobId = await enqueueMessage({
                            jobType: 'whatsapp_message',
                            pageId: phoneNumberId,
                            messageId: msg.id,
                            senderId: msg.from,
                            text: msg.text.body,
                            senderName,
                            requestId: this.requestId,
                        });

                        this.log().info('[WhatsApp] Message enqueued', { messageId: msg.id, jobId });
                    } catch (error) {
                        this.log().error('[WhatsApp] Failed to enqueue message', {
                            messageId: msg.id, error: String(error),
                        });
                    }
                }
            }
        }
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

        // Process deletion asynchronously (don't block the response)
        (async () => {
            try {
                // Find user by Facebook ID
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
                    this.log().info('No user found for Facebook data deletion request', { facebookUserId });
                }
            } catch (error) {
                captureError(error, 'Facebook data deletion failed', {
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
