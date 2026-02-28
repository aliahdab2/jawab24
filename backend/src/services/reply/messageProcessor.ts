import { workspaceSettingsService } from '../workspaceSettings';
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
import { formatBusinessProfile } from '../../utils/businessProfile';
import { getStoreContextForAI } from '../ecommerce';

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
 *  5. Debounce check (fast-path: skipped when replyDelay > 0)
 *  6. Handoff pause check
 *  7. Rate limit check
 *  8. User settings check + away message
 *  9. Skip if already replied/flagged
 *  9b. Greeting gate (first conversation only — early return)
 * 10. Reply delay (doubles as consolidation window)
 * 10b. Post-delay debounce re-check
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
            if (!page.workspaceId) {
                pipelineMetrics.record(pipeline, 'no_workspace');
                return { success: false, messageId: platformMessageId, error: 'Page has no associated workspace' };
            }

            // 2. Check auto-reply enabled for this platform
            if (!page.autoReplyEnabled) {
                pipelineMetrics.record(pipeline, 'auto_reply_disabled');
                return { success: false, messageId: platformMessageId, error: `Auto-reply disabled for ${platform}` };
            }

            const userId = page.userId;
            const workspaceId = page.workspaceId;

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

            // Load settings early — needed for debounce gating and downstream checks
            const userSettings = await workspaceSettingsService.getSettings(workspaceId);

            // 5. Debounce: skip if a newer unreplied message exists from the same sender.
            //    When replyDelay > 0, skip this early check — the delay acts as a
            //    consolidation window, and we re-check after the delay (step 10b).
            const internalMessageId = adapter.getInternalMessageId(platformMessageId);
            const replyDelay = await workspaceSettingsService.getReplyDelay(workspaceId);
            if (replyDelay === 0) {
                const hasNewer = await messagesService.hasNewerUnrepliedMessage(page.id, senderId, internalMessageId);
                lap('5-debounce');
                if (hasNewer) {
                    pipelineMetrics.record(pipeline, 'debounce_skipped');
                    this.logger.info(`[${platform}] Skipping — newer message pending`, { messageId: platformMessageId, senderId });
                    return { success: false, messageId: platformMessageId, error: 'Skipped: newer message pending' };
                }
            } else {
                lap('5-debounce(skipped,delay>0)');
            }

            // 6. Handoff pause check
            const pauseMinutes = userSettings.handoffPauseDurationMinutes;
            const isPaused = await messagesService.isPaused(page.id, senderId, pauseMinutes);
            lap('6-isPaused');
            if (isPaused) {
                const remainingMs = await messagesService.getRemainingPauseMs(page.id, senderId, pauseMinutes);
                const delayMs = remainingMs > 0 ? remainingMs + 5000 : pauseMinutes * 60 * 1000;
                pipelineMetrics.record(pipeline, 'handoff_active');
                this.logger.info(`[${platform}] Handoff active — requesting re-enqueue`, {
                    senderId, pageId: page.id, delayMs,
                });
                return { success: false, messageId: platformMessageId, error: 'Handoff active', handoffDelayMs: delayMs };
            }

            // 7. Rate limit check
            const rateCheck = await rateLimiter.check(page.id, senderId, 'message');
            lap('7-rateLimit');
            if (!rateCheck.allowed) {
                pipelineMetrics.record(pipeline, 'rate_limited');
                this.logger.info(`[${platform}] Message rate limited`, { senderId, count: rateCheck.count });
                return { success: false, messageId: platformMessageId, error: 'Rate limited' };
            }

            // 8. Workspace settings check
            const isMessagesEnabled = await workspaceSettingsService.isMessagesAutoReplyEnabled(workspaceId);
            lap('8-settingsCheck');
            if (!isMessagesEnabled) {
                const customerLang = detectLanguageCode(messageText);
                const awayMessage = await workspaceSettingsService.getAwayMessage(workspaceId, customerLang);
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

            // 9b. Send Greeting Message (first message in conversation only)
            if (isNew && await messagesService.isFirstIncomingMessage(page.id, senderId)) {
                const detectedLang = detectLanguageCode(messageText);
                const greeting = await workspaceSettingsService.getGreetingMessage(workspaceId, detectedLang);
                if (greeting) {
                    try {
                        await adapter.sendReply(page, senderId, greeting);
                        await messagesService.storeOutgoingMessage(page.id, senderId, greeting, 'template');
                        await messagesService.markAsReplied(storedMessage.id, greeting, 'template');
                        this.logger.info(`[${platform}] Sent greeting message`, { senderId });
                        pipelineMetrics.record(pipeline, 'greeting_sent');
                        return { success: true, messageId: platformMessageId, replyText: greeting, replyMethod: 'template' as const };
                    } catch (error) {
                        this.logger.error(`[${platform}] Failed to send greeting message — falling back to AI`, { error: String(error) });
                        // Continue to AI reply as fallback
                    }
                }
            }

            // 10. Reply delay (doubles as consolidation window when > 0)
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }
            lap('10-replyDelay');

            // 10b. Post-delay debounce re-check: after waiting, a newer message
            //      may have arrived. Let the newer job handle the consolidated reply.
            if (replyDelay > 0) {
                const hasNewer = await messagesService.hasNewerUnrepliedMessage(page.id, senderId, internalMessageId);
                lap('10b-postDelayDebounce');
                if (hasNewer) {
                    pipelineMetrics.record(pipeline, 'debounce_skipped');
                    this.logger.info(`[${platform}] Skipping after delay — newer message pending`, { messageId: platformMessageId, senderId });
                    return { success: false, messageId: platformMessageId, error: 'Skipped: newer message pending (post-delay)' };
                }
            }

            // 11. Consolidate all unreplied messages from this sender
            const unrepliedMessages = await messagesService.getUnrepliedFromSender(page.id, senderId);
            lap('11-consolidate');

            // Use latest message for template matching (reflects current intent),
            // but full consolidation for AI context (gives conversation history).
            const latestMessageText = unrepliedMessages.length > 0
                ? unrepliedMessages[unrepliedMessages.length - 1].message
                : messageText;
            const consolidatedText = unrepliedMessages.length > 1
                ? unrepliedMessages.map(m => m.message).join('\n')
                : messageText;

            // 12. Generate reply (enrich KB with e-commerce data if linked)
            let knowledgeBase = page.knowledgeBase || undefined;
            let storePolicies: string | undefined;
            let productCatalog: string | undefined;
            for (const integration of integrationRegistry.getEnabled()) {
                const enriched = await integration.enrichKnowledgeBase(knowledgeBase, page as unknown as Record<string, unknown>);
                if (enriched !== null) { knowledgeBase = enriched; break; }
            }

            // Fetch store policies + product catalog so they survive RAG mode (RAG drops static KB)
            const ecommerceStoreId = (page as unknown as Record<string, unknown>).ecommerceStoreId;
            if (ecommerceStoreId && typeof ecommerceStoreId === 'string') {
                try {
                    const storeCtx = await getStoreContextForAI(ecommerceStoreId);
                    storePolicies = storeCtx.storePolicies;
                    productCatalog = storeCtx.productCatalog;
                } catch { /* non-critical */ }
            }

            // Append business profile (hours, location, phone) to KB context
            const profileText = formatBusinessProfile(page.businessProfile);
            if (profileText) {
                knowledgeBase = knowledgeBase
                    ? `${knowledgeBase}\n\n--- Business Info ---\n${profileText}`
                    : profileText;
            }
            let { replyText, replyMethod, needsAttention, flagReason, aiIntent, confidence } =
                await replyGenerator.generateForMessage(
                    {
                        workspaceId,
                        userId,
                        text: consolidatedText,
                        templateMatchText: latestMessageText,
                        pageName: page.name || undefined,
                        knowledgeBase,
                        storePolicies,
                        productCatalog,
                        kbActiveVersion: page.kbActiveVersion,
                        pageId: page.id,
                        senderId,
                        replyStyle: userSettings.replyStyle,
                        brandVoiceNotes: userSettings.brandVoiceNotes || undefined,
                    },
                    userSettings.aiEnabled ?? false,
                );
            lap('12-generateReply');

            // Capture the original AI-generated reply before any modifications (fallback substitution)
            const aiOriginalReply = replyMethod === 'ai' ? (replyText ?? undefined) : undefined;

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

            // 12d. Hold low-confidence replies for merchant review when enabled
            if (userSettings.holdLowConfidence && confidence === 'low' && replyMethod === 'ai') {
                await messagesService.markAsReplied(
                    storedMessage.id, '', replyMethod,
                    true, 'held_low_confidence', aiIntent, db, aiOriginalReply,
                );
                if (page.userId) {
                    notificationService.sendTemplateNotification(
                        page.userId,
                        'flagged_reply',
                        { senderName: senderName || senderId, reason: 'held_low_confidence' },
                        { messageId: storedMessage.id, type: 'message', deepLink: '/messages?filter=flagged' },
                    ).catch(err => this.logger.error('Held reply notification failed', { err }));
                }
                pipelineMetrics.record(pipeline, 'held_low_confidence');
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
                await messagesService.markAsReplied(storedMessage.id, replyText, replyMethod, needsAttention, flagReason, aiIntent, tx, aiOriginalReply);

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

            // 18. Structured per-reply log — single line with all reply metadata
            this.logger.info(`[${platform}] reply_sent`, {
                event: 'reply_sent',
                pipeline,
                platform,
                pageId: page.id,
                senderId,
                replyMethod,
                aiIntent,
                confidence,
                flagReason: flagReason || null,
                needsAttention,
                replyLength: replyText.length,
                consolidatedCount: unrepliedMessages.length,
                durationMs: Date.now() - t0,
            });

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
