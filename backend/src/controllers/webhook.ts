import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { replyService } from '../services/reply';
import { instagramReplyService } from '../services/instagramReply';

interface WebhookEntry {
    id: string;
    time: number;
    messaging?: any[];
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
    /**
     * Verify webhook token (Facebook challenge)
     * GET /webhook
     */
    async verifyWebhook(request: FastifyRequest<{ Querystring: { 'hub.mode': string; 'hub.verify_token': string; 'hub.challenge': string } }>, reply: FastifyReply) {
        const mode = request.query['hub.mode'];
        const token = request.query['hub.verify_token'];
        const challenge = request.query['hub.challenge'];

        if (mode && token) {
            if (mode === 'subscribe' && token === config.facebook.webhookVerifyToken) {
                console.log('WEBHOOK_VERIFIED');
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
        const body = request.body as WebhookBody;

        // Log the webhook for debugging
        console.log('Received webhook:', JSON.stringify(body, null, 2));

        if (body.object === 'page') {
            // Process Facebook webhooks asynchronously
            this.processWebhookAsync(body.entry).catch(err => {
                console.error('Error processing Facebook webhook:', err);
            });

            return reply.status(200).send('EVENT_RECEIVED');
        } else if (body.object === 'instagram') {
            // Process Instagram webhooks asynchronously
            this.processInstagramWebhookAsync(body.entry).catch(err => {
                console.error('Error processing Instagram webhook:', err);
            });

            return reply.status(200).send('EVENT_RECEIVED');
        } else {
            // Return a '404 Not Found' if event is not from a page or instagram subscription
            console.log(`Unknown webhook object type: ${body.object}`);
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
    private async processMessage(pageId: string, event: any) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;
        const messageId = event.message?.mid;

        if (!senderId || !messageText) {
            return;
        }

        // Ignore messages from the page itself (if any echo)
        // Note: standard messaging events usually don't include echoes unless explicitly subscribed, 
        // but good to be safe if logic allows checking. 
        // Since we don't have the page's own ID easily available here without lookup, 
        // we assume the event is from a user.

        console.log(`Processing message from ${senderId}: ${messageText}`);

        try {
            const result = await replyService.processMessage(
                pageId,
                senderId,
                messageText,
                messageId
            );

            if (result.success) {
                console.log(`Successfully replied to message ${messageId}`);
            } else {
                console.log(`Failed to reply to message ${messageId}: ${result.error}`);
            }
        } catch (error) {
            console.error(`Error processing message ${messageId}:`, error);
        }
    }

    /**
     * Process a single change event
     */
    private async processChange(pageId: string, change: WebhookChange) {
        console.log(`Processing change: ${change.field} - ${change.value.item} - ${change.value.verb}`);

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
            console.log('New post detected:', value.post_id);
            // Posts are handled when comments come in
        }
    }

    /**
     * Process a new comment
     */
    private async processNewComment(pageId: string, value: WebhookChange['value']) {
        const { comment_id, post_id, message, from } = value;

        if (!comment_id || !post_id || !message) {
            console.log('Missing required fields for comment processing');
            return;
        }

        // Don't reply to our own comments (page's comments)
        if (from?.id === pageId) {
            console.log('Skipping own comment');
            return;
        }

        console.log(`Processing new comment: ${comment_id} on post ${post_id}`);

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
                console.log(`Successfully replied to comment ${comment_id} with method: ${result.replyMethod}`);
            } else {
                console.log(`Failed to reply to comment ${comment_id}: ${result.error}`);
            }
        } catch (error) {
            console.error(`Error processing comment ${comment_id}:`, error);
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
        console.log(`[Instagram] Processing change: ${change.field}`);

        // Handle comments on Instagram media
        if (change.field === 'comments') {
            await this.processInstagramComment(instagramAccountId, change.value);
        }

        // Handle mentions
        if (change.field === 'mentions') {
            console.log('[Instagram] Mention received - not processing for now');
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
            console.log('[Instagram] Missing required fields for comment processing');
            return;
        }

        // Don't reply to our own comments
        if (from?.id === instagramAccountId) {
            console.log('[Instagram] Skipping own comment');
            return;
        }

        console.log(`[Instagram] Processing new comment: ${commentId} on media ${mediaId}`);

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
                console.log(`[Instagram] Successfully replied to comment ${commentId}`);
            } else {
                console.log(`[Instagram] Failed to reply to comment ${commentId}: ${result.error}`);
            }
        } catch (error) {
            console.error(`[Instagram] Error processing comment ${commentId}:`, error);
        }
    }

    /**
     * Process an Instagram DM
     */
    private async processInstagramMessage(instagramAccountId: string, event: any) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;
        const messageId = event.message?.mid;

        if (!senderId || !messageText) {
            return;
        }

        console.log(`[Instagram] Processing message from ${senderId}: ${messageText}`);

        try {
            const result = await instagramReplyService.processMessage(
                instagramAccountId,
                senderId,
                messageText,
                messageId
            );

            if (result.success) {
                console.log(`[Instagram] Successfully replied to message ${messageId}`);
            } else {
                console.log(`[Instagram] Failed to reply to message ${messageId}: ${result.error}`);
            }
        } catch (error) {
            console.error(`[Instagram] Error processing message ${messageId}:`, error);
        }
    }
}

export const webhookController = new WebhookController();
