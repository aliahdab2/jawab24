import { settingsService } from '../settings';
import { messagesService } from '../messages';
import { rateLimiter } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator } from './generator';
import { pipelineMetrics, Pipeline } from '../../lib/pipelineMetrics';
import { Logger, noopLogger } from '../../types';
import type { MessagePlatformAdapter, MessageResult } from '../../interfaces';

/**
 * Unified Message Processor
 *
 * Platform-agnostic pipeline for processing incoming DMs.
 * All platform-specific behavior is injected via the adapter.
 *
 * Step order (normalized across all platforms):
 *  1. Validate page
 *  2. Check platform auto-reply
 *  3. Fetch sender name (best-effort)
 *  4. Store incoming message
 *  5. Debounce check
 *  6. Handoff pause check
 *  7. Rate limit check
 *  8. User settings check + away message
 *  9. Skip if already replied
 * 10. Reply delay
 * 11. Consolidate unreplied messages
 * 12. Generate reply
 * 13. Send reply
 * 14. Mark as replied
 * 15. Store outgoing message
 * 16. Mark older debounced messages
 * 17. Notify if flagged
 */
export class MessageProcessor {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
        rateLimiter.setLogger(logger);
        replyGenerator.setLogger(logger);
    }

    async processMessage(
        adapter: MessagePlatformAdapter,
        platformPageId: string,
        senderId: string,
        messageText: string,
        platformMessageId: string,
    ): Promise<MessageResult> {
        const platform = adapter.platform;
        const pipeline = `${platform}_message` as Pipeline;

        try {
            // 1. Validate page
            const page = await adapter.getPage(platformPageId);
            if (!page) {
                pipelineMetrics.record(pipeline, 'page_not_found');
                return { success: false, messageId: platformMessageId, error: 'Page not found' };
            }
            if (!page.userId) {
                pipelineMetrics.record(pipeline, 'no_user');
                return { success: false, messageId: platformMessageId, error: 'Page has no associated user' };
            }

            // 2. Check auto-reply enabled for this platform
            if (!page.autoReplyEnabled) {
                pipelineMetrics.record(pipeline, 'auto_reply_disabled');
                return { success: false, messageId: platformMessageId, error: `Auto-reply disabled for ${platform}` };
            }

            const userId = page.userId;

            // 3. Fetch sender name (best-effort)
            let senderName: string | undefined;
            try {
                senderName = await adapter.fetchSenderName(senderId, page.accessToken);
            } catch {
                // Non-critical — continue without sender name
            }

            // 4. Store incoming message
            const { message: storedMessage, isNew } = await adapter.storeIncomingMessage(
                page.id,
                platformMessageId,
                senderId,
                messageText,
                senderName,
            );

            // 5. Debounce: skip if a newer unreplied message exists from the same sender
            const internalMessageId = adapter.getInternalMessageId(platformMessageId);
            const hasNewer = await messagesService.hasNewerUnrepliedMessage(page.id, senderId, internalMessageId);
            if (hasNewer) {
                pipelineMetrics.record(pipeline, 'debounce_skipped');
                this.logger.info(`[${platform}] Skipping — newer message pending`, { messageId: platformMessageId, senderId });
                return { success: false, messageId: platformMessageId, error: 'Skipped: newer message pending' };
            }

            // 6. Handoff pause check
            const isPaused = await messagesService.isPaused(page.id, senderId);
            if (isPaused) {
                pipelineMetrics.record(pipeline, 'handoff_active');
                this.logger.info(`[${platform}] Skipping — handoff active`, { senderId, pageId: page.id });
                return { success: false, messageId: platformMessageId, error: 'Handoff active' };
            }

            // 7. Rate limit check
            const rateCheck = await rateLimiter.check(page.id, senderId, 'message');
            if (!rateCheck.allowed) {
                pipelineMetrics.record(pipeline, 'rate_limited');
                this.logger.info(`[${platform}] Message rate limited`, { senderId, count: rateCheck.count });
                return { success: false, messageId: platformMessageId, error: 'Rate limited' };
            }

            // 8. User settings check
            const isMessagesEnabled = await settingsService.isMessagesAutoReplyEnabled(userId);
            if (!isMessagesEnabled) {
                const awayMessage = await settingsService.getAwayMessage(userId);
                if (awayMessage && isNew) {
                    try {
                        await adapter.sendAwayMessage(page, senderId, awayMessage);
                        await messagesService.storeOutgoingMessage(page.id, senderId, awayMessage, 'template');
                    } catch {
                        this.logger.debug(`[${platform}] Failed to send away message`);
                    }
                }
                pipelineMetrics.record(pipeline, 'settings_disabled');
                return { success: false, messageId: platformMessageId, error: 'Messages auto-reply disabled' };
            }

            // 9. Skip if already replied
            if (!isNew && storedMessage.replied) {
                pipelineMetrics.record(pipeline, 'already_replied');
                return { success: false, messageId: platformMessageId, error: 'Message already replied' };
            }

            // 10. Reply delay
            const replyDelay = await settingsService.getReplyDelay(userId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 11. Consolidate all unreplied messages from this sender
            const unrepliedMessages = await messagesService.getUnrepliedFromSender(page.id, senderId);
            const consolidatedText = unrepliedMessages.length > 1
                ? unrepliedMessages.map(m => m.message).join('\n')
                : messageText;

            // 12. Generate reply
            const userSettings = await settingsService.getSettings(userId);
            const { replyText, replyMethod, needsAttention, flagReason, aiIntent } =
                await replyGenerator.generateForMessage(
                    {
                        userId,
                        text: consolidatedText,
                        pageName: page.name || undefined,
                        knowledgeBase: page.knowledgeBase || undefined,
                        pageId: page.id,
                        senderId,
                    },
                    userSettings.aiEnabled ?? false,
                );

            if (!replyText) {
                pipelineMetrics.record(pipeline, 'no_reply_generated');
                return { success: false, messageId: platformMessageId, error: 'No reply generated' };
            }

            // 13. Send reply
            try {
                await adapter.sendReply(page, senderId, replyText);
            } catch (error) {
                pipelineMetrics.record(pipeline, 'send_failed');
                this.logger.error(`[${platform}] Failed to send reply`, { error: String(error) });
                return { success: false, messageId: platformMessageId, error: 'Failed to send reply' };
            }

            // 14. Mark as replied
            await adapter.markAsReplied(storedMessage.id, replyText, replyMethod, needsAttention, flagReason, aiIntent);

            // 15. Store outgoing message
            await messagesService.storeOutgoingMessage(page.id, senderId, replyText, replyMethod);

            // 16. Mark older debounced messages as replied
            if (unrepliedMessages.length > 1) {
                const marked = await messagesService.markOlderMessagesAsReplied(
                    page.id, senderId, storedMessage.id, replyText, replyMethod,
                );
                if (marked > 0) {
                    this.logger.info(`[${platform}] Marked older debounced messages as replied`, { count: marked, senderId });
                }
            }

            // 17. Notify if flagged
            if (needsAttention && page.userId) {
                notificationService.sendTemplateNotification(
                    page.userId,
                    'flagged_reply',
                    { senderName: senderName || senderId, reason: flagReason || 'AI flagged this reply' },
                    { messageId: storedMessage.id, type: 'message', deepLink: '/messages?filter=flagged' },
                ).catch(err => this.logger.error('Flagged notification failed', { err }));
            }

            pipelineMetrics.record(pipeline, 'success');
            return { success: true, messageId: platformMessageId, replyText, replyMethod };

        } catch (error) {
            pipelineMetrics.record(pipeline, 'error');
            this.logger.error(`[${platform}] Error processing message`, {
                messageId: platformMessageId,
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                success: false,
                messageId: platformMessageId,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const messageProcessor = new MessageProcessor();
