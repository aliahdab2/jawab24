import { workspaceSettingsService } from '../workspaceSettings';
import { messagesService } from '../messages';
import { rateLimiter } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator, shouldSkipReply, shouldSilentlySkip, shouldUseFallback, PRICE_FALLBACK } from './generator';
import { detectLanguageCode } from '../../utils/language';
import { pipelineMetrics, Pipeline } from '../../lib/pipelineMetrics';
import { acquireReplyLock, releaseReplyLock } from '../../lib/replyLock';
import { Logger, noopLogger } from '../../types';
import { db } from '../../db';
import type { MessagePlatformAdapter, MessageResult } from '../../interfaces';
import { enrichPageContext } from './contextEnricher';
import { publishSSEEvent } from '../../lib/eventBus';
import { invalidateWorkspaceStatsCache } from '../pages';
import { subscriptionsService } from '../subscriptions';
import { facebookService } from '../facebook';
import { instagramService } from '../instagram';
import type { SSEMessageSnapshot } from '@jawab24/shared';
import { isUrgentFlag, buildNotificationReason } from './urgentFlags';
import { truncateAtSentence } from '../../utils/text';
import { leadExtractorService } from '../leadExtractor';
import { extractPostId } from '../../utils/instagram';

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
 *  4b. Acquire distributed lock (Redis SET NX EX 60) — prevents double-replies
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
        sharedPostUrl?: string,
        sharedPostId?: string,
    ): Promise<MessageResult> {
        const platform = adapter.platform;
        const pipeline = `${platform}_message` as Pipeline;
        const t0 = Date.now();
        const lap = (label: string) => {
            this.logger.debug(`[${platform}] ⏱ ${label}`, { ms: Date.now() - t0, messageId: platformMessageId });
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

            // 2. Fetch sender name (best-effort) — do this BEFORE auto-reply check
            // so dashboard always shows real names, even when page is OFF
            let senderName: string | undefined;
            try {
                senderName = await adapter.fetchSenderName(senderId, page.accessToken, page.id, platformPageId);
            } catch {
                // Non-critical — continue without sender name
            }
            lap('2-fetchSenderName');

            // 3. Store incoming message (before auto-reply check so name is persisted)
            const { message: storedMessage, isNew } = await adapter.storeIncomingMessage(
                page.id,
                platformMessageId,
                senderId,
                messageText,
                senderName,
            );
            lap('3-storeMessage');

            // SSE: notify merchant that a new message arrived
            publishSSEEvent(page.userId, 'message:received', {
                messageId: platformMessageId,
                pageId: page.id,
                senderId,
                senderName: senderName ?? null,
                message: {
                    id: storedMessage.id,
                    pageId: page.id,
                    platformMessageId: platformMessageId,
                    senderId,
                    senderName: senderName ?? null,
                    message: messageText,
                    direction: 'incoming' as const,
                    replied: false,
                    replyText: null,
                    replyMethod: null,
                    createdTime: null,
                    repliedAt: null,
                    createdAt: new Date().toISOString(),
                },
            });

            // Invalidate dashboard stats so next load reflects the new message
            invalidateWorkspaceStatsCache(page.workspaceId);

            // 3.5. Enrich with shared post context (if customer attached a post to their message)
            if (sharedPostUrl || sharedPostId) {
                try {
                    const resolvedId = extractPostId(sharedPostUrl, sharedPostId);
                    if (resolvedId) {
                        const postContent = platform === 'instagram'
                            ? await instagramService.getPostContent(resolvedId, page.accessToken)
                            : await facebookService.getPostContent(resolvedId, page.accessToken);
                        if (postContent) {
                            messageText = `[Shared post: "${postContent.slice(0, 200)}"] ${messageText}`;
                            this.logger.info(`[${platform}] Enriched message with shared post context`, {
                                platformMessageId, postContentLength: postContent.length,
                            });
                        }
                    }
                } catch {
                    // Non-critical — continue with original message text
                }
                lap('3.5-sharedPostEnrich');
            }

            // 4. Check auto-reply enabled — after storing so dashboard has the message with name
            // Page OFF = Jawab24 is invisible. No reply, no flag, no notification.
            if (!page.autoReplyEnabled) {
                pipelineMetrics.record(pipeline, 'auto_reply_disabled');
                return { success: false, messageId: platformMessageId, error: `Auto-reply disabled for ${platform}` };
            }

            const userId = page.userId;
            const workspaceId = page.workspaceId;

            // 4a. Subscription gate — all automation stops when subscription is inactive
            const isActive = await subscriptionsService.isSubscriptionActive(userId);
            if (!isActive) {
                pipelineMetrics.record(pipeline, 'subscription_inactive');
                this.logger.info(`[${platform}] Subscription inactive — skipping reply`, { userId, pageId: page.id });
                return { success: false, messageId: platformMessageId, error: 'Subscription inactive' };
            }
            lap('4a-subscriptionCheck');

            // 4b. Acquire distributed lock — prevents two workers from replying to
            //     the same sender simultaneously (covers greeting race + reply race).
            const lockToken = await acquireReplyLock(page.id, senderId);
            if (!lockToken) {
                pipelineMetrics.record(pipeline, 'lock_contention');
                this.logger.info(`[${platform}] Lock held — another worker handling`, { senderId, pageId: page.id });
                return { success: false, messageId: platformMessageId, error: 'Lock held by another worker' };
            }
            lap('4b-acquireLock');

            try {
            // Load settings early — needed for debounce gating and downstream checks
            const userSettings = await workspaceSettingsService.getSettings(workspaceId);

            // 5. Debounce: skip if a newer unreplied message exists from the same sender.
            //    The newest message will consolidate all pending messages into one reply.
            //    When replyDelay > 0, skip this early check — the delay acts as a
            //    consolidation window, and we re-check after the delay (step 10b).
            const internalMessageId = adapter.getInternalMessageId(platformMessageId);
            const replyDelay = userSettings.replyDelay;
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

            // 6-8. Run independent guard checks in parallel to reduce latency
            const pauseMinutes = userSettings.handoffPauseDurationMinutes;
            const isMessagesEnabled = workspaceSettingsService.isAutoReplyEnabledFromSettings(userSettings, 'messages');
            const [isPaused, rateCheck] = await Promise.all([
                messagesService.isPaused(page.id, senderId, pauseMinutes),
                rateLimiter.check(page.id, senderId, 'message'),
            ]);
            lap('6-8-guardChecks');

            if (isPaused) {
                const remainingMs = await messagesService.getRemainingPauseMs(page.id, senderId, pauseMinutes);
                const delayMs = remainingMs > 0 ? remainingMs + 5000 : pauseMinutes * 60 * 1000;
                pipelineMetrics.record(pipeline, 'handoff_active');
                this.logger.info(`[${platform}] Handoff active — requesting re-enqueue`, {
                    senderId, pageId: page.id, delayMs,
                });
                return { success: false, messageId: platformMessageId, error: 'Handoff active', handoffDelayMs: delayMs };
            }

            if (!rateCheck.allowed) {
                pipelineMetrics.record(pipeline, 'rate_limited');
                this.logger.info(`[${platform}] Message rate limited`, { senderId, count: rateCheck.count });
                return { success: false, messageId: platformMessageId, error: 'Rate limited' };
            }

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

            // 11. Consolidate all unreplied messages from this sender
            // Note: no post-delay re-check here. If newer messages arrived during the
            // delay, step 11 will include them in the consolidation below. A post-delay
            // skip would cause the newer message to be dropped: Worker 2 already bailed
            // at step 4b ("Lock held"), so nobody would process it.
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

            // 11b. Send typing indicator before AI generation so customer sees "typing..."
            if (adapter.sendTypingIndicator) {
                try { await adapter.sendTypingIndicator(page, senderId); } catch { /* cosmetic */ }
            }

            // 12. Generate reply (enrich KB with e-commerce data if linked)
            const enriched = await enrichPageContext(
                page as unknown as Record<string, unknown>,
                userSettings,
                messageText,
                page.knowledgeBase || undefined,
            );
            const { knowledgeBase, storePolicies, productCatalog, brandVoiceNotes, ecommerceStoreId } = enriched;

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
                        senderName,
                        replyStyle: userSettings.replyStyle,
                        brandVoiceNotes,
                        ecommerceStoreId: typeof ecommerceStoreId === 'string' ? ecommerceStoreId : undefined,
                        defaultReplyLanguage: userSettings.defaultReplyLanguage,
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

            // 12c. Skip reply — silent for spam/tags, flagged for offensive content
            if (shouldSkipReply(flagReason, aiIntent)) {
                if (shouldSilentlySkip(aiIntent)) {
                    // Spam/irrelevant — no flag, no notification
                    pipelineMetrics.record(pipeline, 'skipped_spam');
                    return { success: true, messageId: platformMessageId };
                }

                await messagesService.flagMessage(
                    storedMessage.id, flagReason, aiIntent,
                );

                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'skipped_reply',
                    { senderName: senderName || senderId, reason: flagReason || 'offensive' },
                    { messageId: storedMessage.id, type: 'message', deepLink: '/messages?filter=flagged' },
                ).catch(err => this.logger.error('Offensive message notification failed', { err }));
                pipelineMetrics.record(pipeline, 'skipped_risky');
                return { success: true, messageId: platformMessageId };
            }

            // 12d. Hold low-confidence replies for merchant review when enabled
            if (userSettings.holdLowConfidence && confidence === 'low' && replyMethod === 'ai') {
                await messagesService.markAsReplied(
                    storedMessage.id, '', replyMethod,
                    true, 'held_low_confidence', aiIntent, db, aiOriginalReply,
                );
                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'flagged_reply',
                    { senderName: senderName || senderId, reason: 'held_low_confidence' },
                    { messageId: storedMessage.id, type: 'message', deepLink: '/messages?filter=flagged' },
                ).catch(err => this.logger.error('Held reply notification failed', { err }));
                pipelineMetrics.record(pipeline, 'held_low_confidence');
                return { success: true, messageId: platformMessageId };
            }

            if (!replyText) {
                pipelineMetrics.record(pipeline, 'no_reply_generated');
                return { success: false, messageId: platformMessageId, error: 'No reply generated' };
            }

            // 12e. Enforce platform max message length (Facebook=2000, Instagram=1000)
            const maxReplyChars = adapter.maxReplyLength ?? 2000;
            if (replyText.length > maxReplyChars) {
                const originalLength = replyText.length;
                replyText = truncateAtSentence(replyText, maxReplyChars);
                this.logger.info(`[${platform}] Reply truncated to max message length`, {
                    originalLength,
                    truncatedLength: replyText.length,
                });
            }

            // 13. Send reply
            let deliveryFailed = false;
            try {
                await adapter.sendReply(page, senderId, replyText);
            } catch (error) {
                deliveryFailed = true;
                pipelineMetrics.record(pipeline, 'send_failed');
                this.logger.error(`[${platform}] Failed to send reply`, { error: String(error) });
                // SSE: notify merchant of failed reply
                publishSSEEvent(userId, 'message:reply_failed', {
                    messageId: platformMessageId,
                    pageId: page.id,
                    error: 'Failed to send reply',
                });
                // Still mark message as replied with delivery_failed flag so it doesn't
                // stay in "Needs Action" forever. The AI did its job — delivery is a platform issue.
                await messagesService.markAsReplied(
                    storedMessage.id, replyText, replyMethod,
                    true, 'delivery_failed', aiIntent, undefined, aiOriginalReply,
                );
                return { success: false, messageId: platformMessageId, replyText, replyMethod, error: 'Failed to send reply' };
            }
            lap('13-sendReply');

            // 14-16. Mark replied + store outgoing + mark older — wrapped in a transaction
            // so all DB state changes succeed or fail together.
            let markedOlder = 0;
            let outgoingMessage: SSEMessageSnapshot | undefined;
            await db.transaction(async (tx) => {
                // 14. Mark as replied
                await messagesService.markAsReplied(storedMessage.id, replyText, replyMethod, needsAttention, flagReason, aiIntent, tx, aiOriginalReply);

                // 15. Store outgoing message
                const stored = await messagesService.storeOutgoingMessage(page.id, senderId, replyText, replyMethod, tx);
                outgoingMessage = {
                    id: stored.id,
                    pageId: stored.pageId,
                    platformMessageId: stored.platformMessageId,
                    senderId: stored.senderId,
                    senderName: stored.senderName,
                    message: stored.message,
                    direction: stored.direction,
                    replied: stored.replied,
                    replyText: stored.replyText,
                    replyMethod: stored.replyMethod,
                    createdTime: stored.createdTime ?? null,
                    repliedAt: stored.repliedAt ?? null,
                    createdAt: stored.createdAt ?? new Date().toISOString(),
                };

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

            // 17. Notify if flagged — use enriched reason for high-stakes flags
            if (needsAttention && page.userId) {
                const notifyReason = buildNotificationReason(flagReason, consolidatedText);
                const urgent = isUrgentFlag(flagReason);

                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'flagged_reply',
                    { senderName: senderName || senderId, reason: notifyReason },
                    {
                        messageId: storedMessage.id,
                        type: 'message',
                        deepLink: '/messages?filter=flagged',
                        ...(urgent ? { urgent: true } : {}),
                    },
                ).catch(err => this.logger.error('Flagged notification failed', { err }));
            }

            // SSE: notify merchant that a reply was sent (includes full message for optimistic cache update)
            publishSSEEvent(userId, 'message:reply_sent', {
                messageId: platformMessageId,
                pageId: page.id,
                replyMethod: replyMethod as 'template' | 'ai',
                replyText,
                message: outgoingMessage,
                senderName: senderName ?? null,
            });
            // SSE: update usage counter if AI reply
            if (replyMethod === 'ai') {
                publishSSEEvent(userId, 'usage:updated', { aiRepliesUsed: -1 });
            }

            // Fire-and-forget lead extraction (non-critical — never blocks reply pipeline)
            leadExtractorService.maybeCaptureLead({
                pageId: page.id,
                userId,
                workspaceId,
                sourceId: storedMessage.id,
                sourceType: 'message',
                senderId,
                senderName,
                messageText: consolidatedText,
            }).catch(() => { /* errors captured inside maybeCaptureLead */ });

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

            } finally {
                await releaseReplyLock(page.id, senderId, lockToken).catch(() => { /* TTL will auto-expire */ });
            }

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

// --- Urgent notification helpers ---

// Re-export for backward compatibility (tests and other importers)
export { URGENT_FLAG_MAP, isUrgentFlag, buildNotificationReason } from './urgentFlags';
