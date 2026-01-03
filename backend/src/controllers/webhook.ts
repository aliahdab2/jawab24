import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { replyService } from '../services/reply';
import { instagramReplyService } from '../services/instagramReply';
import { Logger, noopLogger, createRequestLogger } from '../types';

/** Messaging event from Facebook/Instagram webhook */
interface MessagingEvent {
    sender?: { id: string };
    message?: {
        mid: string;
        text?: string;
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

    /** Set logger for the current request context */
    private setLogger(request: FastifyRequest): void {
        this.logger = createRequestLogger(request.log);
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
                    // Only handle text messages
                    if (messageEvent.message && messageEvent.message.text) {
                        await this.processMessage(pageId, messageEvent);
                    }
                }
            }
        }
    }

    /**
     * Process a messaging event
     */
    private async processMessage(pageId: string, event: MessagingEvent) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;
        const messageId = event.message?.mid;

        if (!senderId || !messageText || !messageId) {
            return;
        }

        // Ignore messages from the page itself (if any echo)
        // Note: standard messaging events usually don't include echoes unless explicitly subscribed, 
        // but good to be safe if logic allows checking. 
        // Since we don't have the page's own ID easily available here without lookup, 
        // we assume the event is from a user.

        this.log().info('Processing message', { senderId, messageId, textLength: messageText.length });

        try {
            const result = await replyService.processMessage(
                pageId,
                senderId,
                messageText,
                messageId
            );

            if (result.success) {
                this.log().info('Successfully replied to message', { messageId });
            } else {
                this.log().info('Failed to reply to message', { messageId, error: result.error });
            }
        } catch (error) {
            this.log().error('Error processing message', { messageId, error: String(error) });
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
     * Process a new comment
     */
    private async processNewComment(pageId: string, value: WebhookChange['value']) {
        const { comment_id, post_id, message, from } = value;

        if (!comment_id || !post_id || !message) {
            this.log().debug('Missing required fields for comment processing', { comment_id, post_id, hasMessage: !!message });
            return;
        }

        // Don't reply to our own comments (page's comments)
        if (from?.id === pageId) {
            this.log().debug('Skipping own comment', { comment_id });
            return;
        }

        this.log().info('Processing new comment', { comment_id, post_id });

        try {
            const result = await replyService.processComment(
                pageId,
                post_id,
                comment_id,
                message,
                from?.id,
                from?.name
            );

            if (result.success) {
                this.log().info('Successfully replied to comment', { comment_id, replyMethod: result.replyMethod });
            } else {
                this.log().info('Failed to reply to comment', { comment_id, error: result.error });
            }
        } catch (error) {
            this.log().error('Error processing comment', { comment_id, error: String(error) });
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
     * Process an Instagram comment
     */
    private async processInstagramComment(instagramAccountId: string, value: WebhookChange['value']) {
        const commentId = value.id;
        const commentText = value.text;
        const mediaId = value.media?.id;
        const from = value.from;

        if (!commentId || !commentText || !mediaId) {
            this.log().debug('[Instagram] Missing required fields for comment processing', { commentId, mediaId, hasText: !!commentText });
            return;
        }

        // Don't reply to our own comments
        if (from?.id === instagramAccountId) {
            this.log().debug('[Instagram] Skipping own comment', { commentId });
            return;
        }

        this.log().info('[Instagram] Processing new comment', { commentId, mediaId });

        try {
            const result = await instagramReplyService.processComment(
                instagramAccountId,
                mediaId,
                commentId,
                commentText,
                from?.id,
                from?.username
            );

            if (result.success) {
                this.log().info('[Instagram] Successfully replied to comment', { commentId });
            } else {
                this.log().info('[Instagram] Failed to reply to comment', { commentId, error: result.error });
            }
        } catch (error) {
            this.log().error('[Instagram] Error processing comment', { commentId, error: String(error) });
        }
    }

    /**
     * Process an Instagram DM
     */
    private async processInstagramMessage(instagramAccountId: string, event: MessagingEvent) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;
        const messageId = event.message?.mid;

        if (!senderId || !messageText || !messageId) {
            return;
        }

        this.log().info('[Instagram] Processing message', { senderId, messageId, textLength: messageText.length });

        try {
            const result = await instagramReplyService.processMessage(
                instagramAccountId,
                senderId,
                messageText,
                messageId
            );

            if (result.success) {
                this.log().info('[Instagram] Successfully replied to message', { messageId });
            } else {
                this.log().info('[Instagram] Failed to reply to message', { messageId, error: result.error });
            }
        } catch (error) {
            this.log().error('[Instagram] Error processing message', { messageId, error: String(error) });
        }
    }
}

export const webhookController = new WebhookController();
