import { settingsService } from '../settings';
import { messagesService } from '../messages';
import { rateLimiter } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator, shouldSkipReply, shouldUseFallback, PRICE_FALLBACK } from './generator';
import { detectLanguageCode } from '../../utils/language';
import { integrationRegistry } from '../../integrations';
import { pipelineMetrics, Pipeline } from '../../lib/pipelineMetrics';
import { Logger, noopLogger } from '../../types';
import { db } from '../../db';
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
 *  9. Skip if already replied/flagged
 * 10. Reply delay
 * 11. Consolidate unreplied messages
 * 12. Generate reply
 * 12b. Replace with safe fallback for price_not_in_kb
 * 12c. Skip reply entirely for offensive content
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
        const t0 = Date.now();
        const lap = (label: string) => {
            this.logger.info(`[${platform}] ⏱ ${label}`, { ms: Date.now() - t0, messageId: platformMessageId });
        };

        try {
            // 1. Validate page
            const page = await adapter.getPage(platformPageId);
            lap('1-getPage');
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
                senderName = await adapter.fetchSenderName(senderId, page.accessToken, page.id);
            } catch {
                // Non-critical — continue without sender name
            }
            lap('3-fetchSenderName');

            // 4. Store incoming message
            const { message: storedMessage, isNew } = await adapter.storeIncomingMessage(
                page.id,
                platformMessageId,
                senderId,
                messageText,
                senderName,
            );
            lap('4-storeMessage');

            // 5. Debounce: skip if a newer unreplied message exists from the same sender
            const internalMessageId = adapter.getInternalMessageId(platformMessageId);
            const hasNewer = await messagesService.hasNewerUnrepliedMessage(page.id, senderId, internalMessageId);
            lap('5-debounce');
            if (hasNewer) {
                pipelineMetrics.record(pipeline, 'debounce_skipped');
                this.logger.info(`[${platform}] Skipping — newer message pending`, { messageId: platformMessageId, senderId });
                return { success: false, messageId: platformMessageId, error: 'Skipped: newer message pending' };
            }

            // 6. Handoff pause check
            const isPaused = await messagesService.isPaused(page.id, senderId);
            lap('6-isPaused');
            if (isPaused) {
                pipelineMetrics.record(pipeline, 'handoff_active');
                this.logger.info(`[${platform}] Skipping — handoff active`, { senderId, pageId: page.id });
                return { success: false, messageId: platformMessageId, error: 'Handoff active' };
            }

            // 7. Rate limit check
            const rateCheck = await rateLimiter.check(page.id, senderId, 'message');
            lap('7-rateLimit');
            if (!rateCheck.allowed) {
                pipelineMetrics.record(pipeline, 'rate_limited');
                this.logger.info(`[${platform}] Message rate limited`, { senderId, count: rateCheck.count });
                return { success: false, messageId: platformMessageId, error: 'Rate limited' };
            }

            // 8. User settings check
            const isMessagesEnabled = await settingsService.isMessagesAutoReplyEnabled(userId);
            lap('8-settingsCheck');
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

            // 9. Skip if already replied or already flagged
            if (!isNew && (storedMessage.replied || storedMessage.needsAttention)) {
                pipelineMetrics.record(pipeline, 'already_replied');
                return { success: false, messageId: platformMessageId, error: 'Message already replied' };
            }

            // 10. Reply delay
            const replyDelay = await settingsService.getReplyDelay(userId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }
            lap('10-replyDelay');

            // 11. Consolidate all unreplied messages from this sender
            const unrepliedMessages = await messagesService.getUnrepliedFromSender(page.id, senderId);
            lap('11-consolidate');
            const consolidatedText = unrepliedMessages.length > 1
                ? unrepliedMessages.map(m => m.message).join('\n')
                : messageText;

            // 12. Generate reply (enrich KB with e-commerce data if linked)
            const userSettings = await settingsService.getSettings(userId);
            let knowledgeBase = page.knowledgeBase || undefined;
            for (const integration of integrationRegistry.getEnabled()) {
                const enriched = await integration.enrichKnowledgeBase(knowledgeBase, page as unknown as Record<string, unknown>);
                if (enriched !== null) { knowledgeBase = enriched; break; }
            }
            let { replyText, replyMethod, needsAttention, flagReason, aiIntent } =
                await replyGenerator.generateForMessage(
                    {
                        userId,
                        text: consolidatedText,
                        pageName: page.name || undefined,
                        knowledgeBase,
                        pageId: page.id,
                        senderId,
                    },
                    userSettings.aiEnabled ?? false,
                );
            lap('12-generateReply');

            // 12b. Replace with safe fallback if AI hallucinated a price
            if (shouldUseFallback(flagReason)) {
                const detectedLang = detectLanguageCode(messageText);
                const lang = detectedLang === 'unknown' ? 'en' : detectedLang;
                replyText = PRICE_FALLBACK[lang] || PRICE_FALLBACK['en'];
            }

            // 12c. Skip reply entirely for offensive content
            if (shouldSkipReply(flagReason, aiIntent)) {
                await messagesService.flagMessage(
                    storedMessage.id, flagReason, aiIntent,
                );

                if (page.userId) {
                    notificationService.sendTemplateNotification(
                        page.userId,
                        'skipped_reply',
                        { senderName: senderName || senderId, reason: flagReason || 'offensive' },
                        { messageId: storedMessage.id, type: 'message', deepLink: '/messages?filter=flagged' },
                    ).catch(err => this.logger.error('Offensive message notification failed', { err }));
                }
                pipelineMetrics.record(pipeline, 'skipped_risky');
                return { success: true, messageId: platformMessageId };
            }

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
            lap('13-sendReply');

            // 14-16. Mark replied + store outgoing + mark older — wrapped in a transaction
            // so all DB state changes succeed or fail together.
            let markedOlder = 0;
            await db.transaction(async (tx) => {
                // 14. Mark as replied
                await messagesService.markAsReplied(storedMessage.id, replyText, replyMethod, needsAttention, flagReason, aiIntent, tx);

                // 15. Store outgoing message
                await messagesService.storeOutgoingMessage(page.id, senderId, replyText, replyMethod, tx);

                // 16. Mark older debounced messages as replied
                if (unrepliedMessages.length > 1) {
                    markedOlder = await messagesService.markOlderMessagesAsReplied(
                        page.id, senderId, storedMessage.id, replyText, replyMethod, tx,
                    );
                }
            });
            lap('15-postReply');

            if (markedOlder > 0) {
                this.logger.info(`[${platform}] Marked older debounced messages as replied`, { count: markedOlder, senderId });
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
            lap('DONE');
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
