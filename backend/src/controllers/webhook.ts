import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { enqueueComment, enqueueMessage } from '../lib/replyQueue';
import { messagesService } from '../services/messages';
import { pagesService } from '../services/pages';
import { Logger, noopLogger, createRequestLogger } from '../types';

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
    };
}

interface WebhookEntry {
    id: string;
    time: number;
    messaging?: MessagingEvent[];
    changes?: WebhookChange[];
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
            // Process Facebook webhooks asynchronously
            this.processWebhookAsync(body.entry).catch(err => {
                this.log().error('Error processing Facebook webhook', { error: String(err) });
            });

            return reply.status(200).send('EVENT_RECEIVED');
        } else if (body.object === 'instagram') {
            // Process Instagram webhooks asynchronously
            this.processInstagramWebhookAsync(body.entry).catch(err => {
                this.log().error('Error processing Instagram webhook', { error: String(err) });
            });

            return reply.status(200).send('EVENT_RECEIVED');
        } else {
            // Return a '404 Not Found' if event is not from a page or instagram subscription
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
                    // Only handle text messages
                    if (messageEvent.message && messageEvent.message.text) {
                        await this.processMessage(pageId, messageEvent);
                    }
                }
            }
        }
    }

    /**
     * Process a messaging event - store immediately and enqueue for async reply
     */
    private async processMessage(pageId: string, event: MessagingEvent) {
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
            const page = await pagesService.getPageByFacebookId(pageId);
            if (page) {
                await messagesService.findOrCreateFromWebhook(
                    page.id,
                    messageId,
                    senderId,
                    messageText
                );
            }

            // Enqueue reply job immediately — debounce is handled by hasNewerUnrepliedMessage
            const jobId = await enqueueMessage({
                jobType: 'facebook_message',
                pageId,
                messageId,
                senderId,
                text: messageText,
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
        this.log().debug('Processing change', { 
            field: change.field, 
            item: change.value.item, 
            verb: change.value.verb 
        });

        // Only process feed changes
        if (change.field !== 'feed') {
            return;
        }

        const { value } = change;

        // Only process new comments (not edits or deletes)
        if (value.item === 'comment' && value.verb === 'add') {
            await this.processNewComment(pageId, value);
        }

        // Could also handle new posts here if needed
        if (value.item === 'post' && value.verb === 'add') {
            this.log().info('New post detected', { postId: value.post_id });
            // Posts are handled when comments come in
        }
    }

    /**
     * Process a new comment - enqueue for async processing
     */
    private async processNewComment(pageId: string, value: WebhookChange['value']) {
        const { comment_id, post_id, message, from } = value;

        if (!comment_id || !post_id || !message) {
            this.log().debug('Missing required fields for comment processing', { 
                comment_id, 
                post_id, 
                hasMessage: !!message 
            });
            return;
        }

        // Don't reply to our own comments (page's comments)
        if (from?.id === pageId) {
            this.log().debug('Skipping own comment', { comment_id });
            return;
        }

        this.log().info('Enqueueing comment for processing', { comment_id, post_id });

        try {
            const jobId = await enqueueComment({
                jobType: 'facebook_comment',
                pageId,
                postId: post_id,
                commentId: comment_id,
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
                        await this.processInstagramMessage(instagramAccountId, messageEvent);
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
    private async processInstagramMessage(instagramAccountId: string, event: MessagingEvent) {
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
}

export const webhookController = new WebhookController();
