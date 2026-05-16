import { workspaceSettingsService } from '../workspaceSettings';
import { messagesService } from '../messages';
import { conversationsService } from '../conversations';
import { rateLimiter } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator, shouldSkipReply, shouldSilentlySkip, shouldUseFallback, PRICE_FALLBACK, resolveFallbackLanguage } from './generator';
import { isOpenerMessage } from './openerPatterns';
import { detectLanguageCode } from '../../utils/language';
import { t } from '../../utils/i18n';
import { pipelineMetrics, Pipeline } from '../../lib/pipelineMetrics';
import { acquireReplyLock, releaseReplyLock } from '../../lib/replyLock';
import * as typingIndicator from './typingIndicator';
import { Logger, noopLogger } from '../../types';
import { db } from '../../db';
import { posts, instagramMedia, messages } from '../../db/schema';
import { eq } from 'drizzle-orm';
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
import {
    isTransientFbError,
    isTransientAiError,
    needsImmediateAttention,
    AiRefusalError,
} from '../../utils/fbGraphErrors';
import { leadExtractorService } from '../leadExtractor';
import { extractPostId } from '../../utils/instagram';

/** Max age of the origin post to inherit into a follow-up DM's AI context.
 *  Older posts often contain relative-time claims ("tomorrow we start X") that
 *  would mislead the AI. Above this threshold we degrade to context-free —
 *  better no context than stale context. Pre-existing comments on old posts
 *  have the same issue and are out of scope for this pass. */
const MAX_ORIGIN_POST_AGE_MS = 60 * 24 * 60 * 60 * 1000;

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
            const workspaceId = page.workspaceId;

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
                workspaceId,
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

            // 4a. Subscription gate — all automation (Smart Reply, Post Reply, away msg) stops
            // when subscription is canceled / paused / past_due beyond grace. Respects the
            // 3-day grace window in checkSubscriptionStatus, and fires a one-per-24h
            // notification so the merchant sees why replies are frozen.
            const gate = await subscriptionsService.enforceAutoReplyGate(userId);
            if (!gate.allowed) {
                pipelineMetrics.record(pipeline, 'subscription_inactive');
                this.logger.info(`[${platform}] Subscription inactive — skipping reply`, { userId, pageId: page.id, reason: gate.reason });
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

            // Track the platformMessageIds we handled at step 11 — used by the
            // post-release orphan recheck (finally block) to exclude them and
            // prevent re-processing of flagged/skipped messages that legitimately
            // stay replied=false. Recheck only fires when step 11 was reached
            // (early-return paths have no AI-generation race window).
            const handledPlatformMessageIds = new Set<string>();
            let didReachConsolidation = false;
            // Track typing-indicator lifecycle so abort paths can clear it.
            // Without this, Facebook keeps "typing..." visible for ~20s after
            // we abandon a reply, surfacing as the "typing forever" UX bug.
            let typingShown = false;
            let replySent = false;

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
                // Only send the away message on the customer's very first incoming message.
                // The webhook controller pre-stores the message (see webhook.ts
                // findOrCreateFromWebhook), so by the time the worker runs `isNew` is
                // always false here — gating on it suppressed the away message entirely.
                // Use isFirstIncomingMessage instead: count = 1 right after store → true
                // exactly once per sender, preventing spam on repeat messages.
                if (awayMessage && await messagesService.isFirstIncomingMessage(page.id, senderId)) {
                    try {
                        await adapter.sendAwayMessage(page, senderId, awayMessage);
                        await messagesService.storeOutgoingMessage(page.id, workspaceId, senderId, awayMessage, 'template');
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

            // 9b. Send Greeting Message — fires when EITHER:
            //   (a) The text is a Messenger "Get Started" opener tap (any time, not just
            //       first message — the button can be pressed repeatedly and is always a
            //       system phrase, never a real question. Letting it through to AI yields
            //       confused replies like "do you mean register for a course?"), OR
            //   (b) This is the first incoming message AND the merchant manually configured
            //       a greeting (sourceLang !== 'default'). Default seeded greetings only
            //       fire on opener taps so real first questions still go to AI.
            //
            // NOTE: do NOT gate on `isNew` here. The webhook controller stores the message
            // before enqueuing the worker job (see webhook.ts findOrCreateFromWebhook), so
            // by the time we reach this code `storeIncomingMessage` re-finds the same row
            // and returns isNew=false. Gating on isNew would make this entire block dead
            // code for the normal webhook → worker path. `isFirstIncomingMessage` already
            // gives us the "first message" semantics correctly (count = 1 after store).
            const isOpener = isOpenerMessage(messageText);
            const isFirstIncoming = await messagesService.isFirstIncomingMessage(page.id, senderId);

            if (isOpener || isFirstIncoming) {
                const detectedLang = detectLanguageCode(messageText);
                const settings = await workspaceSettingsService.getSettings(workspaceId);
                const greetingMulti = settings.greetingMessageMulti || {};
                const isCustomConfigured = greetingMulti.sourceLang !== undefined && greetingMulti.sourceLang !== 'default';

                if (isOpener || isCustomConfigured) {
                    const configured = await workspaceSettingsService.getGreetingMessage(workspaceId, detectedLang);
                    const greeting = configured ?? (isOpener ? t('defaultGreeting', detectedLang) : null);
                    if (greeting) {
                        try {
                            await adapter.sendReply(page, senderId, greeting);
                            await messagesService.storeOutgoingMessage(page.id, workspaceId, senderId, greeting, 'template');
                            await messagesService.markAsReplied(storedMessage.id, greeting, 'template');
                            this.logger.info(`[${platform}] Sent greeting message`, { senderId, source: isOpener ? 'opener' : 'configured' });
                            pipelineMetrics.record(pipeline, 'greeting_sent');
                            return { success: true, messageId: platformMessageId, replyText: greeting, replyMethod: 'template' as const };
                        } catch (error) {
                            this.logger.error(`[${platform}] Failed to send greeting message — falling back to AI`, { error: String(error) });
                            // Continue to AI reply as fallback
                        }
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
            for (const m of unrepliedMessages) handledPlatformMessageIds.add(m.platformMessageId);
            didReachConsolidation = true;
            lap('11-consolidate');

            // Use latest message for template matching (reflects current intent),
            // but full consolidation for AI context (gives conversation history).
            const latestMessageText = unrepliedMessages.length > 0
                ? unrepliedMessages[unrepliedMessages.length - 1].message
                : messageText;
            const consolidatedText = unrepliedMessages.length > 1
                ? unrepliedMessages.map(m => m.message).join('\n')
                : messageText;

            // 11b. Show "typing..." before AI generation so the customer sees activity
            // during the 1-3s wait. See typingIndicator.ts for the full contract
            // (retry dedup, abort-path cleanup).
            typingShown = await typingIndicator.show(adapter, page, senderId, platformMessageId);

            // 11c. If this DM thread originated from a comment on a post, carry the
            // post text into the generator context (same field the comment pipeline
            // uses). Without this, short follow-ups like "تكلفة" or "اوقات الدوام"
            // are classified as SPAM_OR_IRRELEVANT because the AI sees them out of context.
            const originPostMessage = await this.resolveOriginPostMessage(page.id, senderId);
            lap('11c-originPost');

            // 12. Generate reply (enrich KB with e-commerce data if linked)
            const enriched = await enrichPageContext(
                page as unknown as Record<string, unknown>,
                userSettings,
                messageText,
                page.knowledgeBase || undefined,
            );
            const { knowledgeBase, storePolicies, productCatalog, brandVoiceNotes, ecommerceStoreId } = enriched;

            let { replyText, replyMethod, needsAttention, flagReason, aiIntent, confidence, productCards } =
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
                        postMessage: originPostMessage,
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
                const lang = resolveFallbackLanguage({
                    text: messageText,
                    knowledgeBase,
                    defaultReplyLanguage: userSettings.defaultReplyLanguage,
                });
                replyText = PRICE_FALLBACK[lang];
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
                // Messenger/Instagram auto-clear the typing indicator when a message
                // arrives, so no explicit typing_off needed on the happy path.
                replySent = true;
            } catch (error) {
                // Transient FB errors (rate limit, 5xx, -1/2018012, network) MUST bubble
                // up to BullMQ so the whole DM job retries — sender.ts throws these
                // specifically to trigger retry. Flagging delivery_failed here would
                // burn the retry and leave the customer with no reply on a recoverable error.
                if (isTransientFbError(error, platform)) {
                    throw error;
                }
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

            // 13b. Follow-up: send product cards if the reply carries them and the
            // platform adapter supports rich attachments. Fire-and-forget — a card
            // send failure doesn't invalidate the text reply already delivered.
            if (productCards?.length && adapter.sendProductCards) {
                adapter.sendProductCards(page, senderId, productCards).catch((error) => {
                    this.logger.warn(`[${platform}] Product card send failed (reply already sent)`, {
                        error: String(error),
                        messageId: platformMessageId,
                    });
                });
            }

            // 14-16. Mark replied + store outgoing + mark older — wrapped in a transaction
            // so all DB state changes succeed or fail together.
            let markedOlder = 0;
            let outgoingMessage: SSEMessageSnapshot | undefined;
            await db.transaction(async (tx) => {
                // 14. Mark as replied
                await messagesService.markAsReplied(storedMessage.id, replyText, replyMethod, needsAttention, flagReason, aiIntent, tx, aiOriginalReply);

                // 15. Store outgoing message
                const stored = await messagesService.storeOutgoingMessage(page.id, workspaceId, senderId, replyText, replyMethod, tx);
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
                replyMethod: replyMethod as 'template' | 'ai' | 'post_reply',
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

                // Clear the typing indicator if we showed one but never sent a reply
                // (spam-skip, hold, empty AI output, non-transient delivery failure,
                // transient error rethrow). The happy path's outgoing message
                // dismisses the indicator automatically.
                if (typingShown && !replySent) {
                    typingIndicator.clear(adapter, page, senderId);
                }

                // Post-release safety net: catch messages that arrived AFTER step 11
                // (during AI generation) and got orphaned at step 4b ('Lock held').
                // Step 11 consolidation only sees messages that exist when it runs;
                // anything arriving during the ~2-5s AI window slips through.
                // Excludes IDs we already saw at step 11 so flagged/skipped messages
                // (offensive, spam) that legitimately stay replied=false don't loop.
                // Only fire when step 11 was reached — early-return paths (debounce,
                // handoff, rate limit, away message) have no AI-generation race window.
                if (didReachConsolidation) {
                    setImmediate(() => {
                        void this.recheckOrphanedMessages(adapter, platformPageId, page.id, senderId, handledPlatformMessageIds);
                    });
                }
            }

        } catch (error) {
            // AI refusal / empty-after-filter — deterministic, no retry value. Flag
            // the message row immediately with the specific reason and notify the
            // merchant. They can act on the refusal reason or empty-filter signal
            // by adjusting KB / brand voice / policy. No rethrow → no BullMQ retry.
            if (needsImmediateAttention(error)) {
                const isRefusal = error instanceof AiRefusalError;
                const flagReason = isRefusal ? 'ai_refused' : 'ai_empty_reply';
                const flagMeta = isRefusal
                    ? { ai_refused: { reason: error.refusalReason } }
                    : { ai_empty_reply: { reason: 'AI reply was empty after content filtering' } };

                try {
                    const row = await db.query.messages.findFirst({
                        where: eq(messages.platformMessageId, platformMessageId),
                    });
                    if (row && !row.replied && !row.needsAttention) {
                        await messagesService.flagMessage(row.id, flagReason, undefined, flagMeta);
                        // workspaceId + senderName pulled from the message row since the
                        // try-block scope's locals aren't reachable from this catch.
                        notificationService.sendTemplateNotificationToWorkspace(
                            row.workspaceId,
                            'flagged_reply',
                            { senderName: row.senderName || senderId || 'Unknown', reason: flagReason },
                            { messageId: row.id, type: 'message', deepLink: '/messages?filter=flagged' },
                        ).catch(err => this.logger.error('[MessageProcessor] AI-failed notification failed', { err }));
                    }
                } catch (flagErr) {
                    this.logger.error('[MessageProcessor] Failed to flag for ai_refused/empty', {
                        flagErr: flagErr instanceof Error ? flagErr.message : String(flagErr),
                        platformMessageId,
                    });
                }

                pipelineMetrics.record(pipeline, 'ai_failed_immediate_flag');
                this.logger.warn(`[${platform}] AI ${flagReason} — flagged immediately, no retry`, {
                    platformMessageId,
                    error: error instanceof Error ? error.message : String(error),
                });
                return {
                    success: false,
                    messageId: platformMessageId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }

            // Transient DM errors MUST bubble up so BullMQ retries the whole job — same
            // rationale as commentProcessor.processComment: sender.ts throws transients
            // (FB rate limit, 5xx, -1/2018012, network) specifically to trigger retry.
            // Returning success:false here makes BullMQ mark the job "completed with
            // failure" and never retry.
            //
            // Same applies to transient AI errors (ai-worker unreachable during deploy,
            // 5xx, circuit-open, tool-loop exhausted, AI_ENABLED=false misdeploy):
            // rethrow so BullMQ retries — never substitute a "شكراً لرسالتك!" reply
            // mid-conversation. After retries exhaust, `flagStuckJobOnFinalFailure` in
            // replyWorker flags the message row needs_attention so the merchant handles it.
            if (isTransientFbError(error, platform) || isTransientAiError(error)) {
                pipelineMetrics.record(pipeline, 'transient_error_retry');
                this.logger.warn(`[${platform}] Transient error — rethrowing for BullMQ retry`, {
                    messageId: platformMessageId,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
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

    /**
     * Post-release orphan check.
     *
     * Closes the residual race left by eb7bda92: messages arriving AFTER step 11
     * (during AI generation) bypass consolidation and their workers bail at the
     * lock check, leaving them permanently unreplied.
     *
     * Runs after the parent worker has released its lock. Fetches any still-
     * unreplied incoming messages from the sender and re-triggers processMessage
     * for the newest one — its own step 11 will consolidate any earlier orphans.
     *
     * Fire-and-forget: errors are logged but do not surface to the caller.
     */
    private async recheckOrphanedMessages(
        adapter: MessagePlatformAdapter,
        platformPageId: string,
        pageId: string,
        senderId: string,
        excludeIds: Set<string>,
    ): Promise<void> {
        try {
            const allUnreplied = await messagesService.getUnrepliedFromSender(pageId, senderId);
            // Exclude messages we already saw at step 11 — these are either flagged
            // (offensive/needs_attention), silently skipped (spam), or already had
            // a reply attempted but stayed replied=false for legitimate reasons.
            // Re-processing them would cause infinite recursion.
            const orphans = allUnreplied.filter(m => !excludeIds.has(m.platformMessageId));
            if (orphans.length === 0) return;

            const newest = orphans[orphans.length - 1];
            this.logger.info(`[${adapter.platform}] orphan_recheck_triggered`, {
                event: 'orphan_recheck',
                pageId,
                senderId,
                orphanCount: orphans.length,
                newestMessageId: newest.platformMessageId,
            });

            await this.processMessage(
                adapter,
                platformPageId,
                senderId,
                newest.message,
                newest.platformMessageId,
            );
        } catch (err) {
            this.logger.error(`[${adapter.platform}] orphan_recheck_failed`, {
                pageId,
                senderId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /**
     * Resolve the originating post/media text for a conversation when the DM
     * thread started from a comment (dual or private mode). Returns undefined
     * when there is no origin link, the referenced row is missing (deleted), or
     * the post is older than MAX_ORIGIN_POST_AGE_MS (staleness guard).
     *
     * Looks up in `posts` (facebook) or `instagram_media` (instagram) based on
     * the conversation's platform. No FK on `origin_content_id` — if the row
     * was deleted, we silently degrade to no context rather than erroring.
     */
    private async resolveOriginPostMessage(pageId: string, senderId: string): Promise<string | undefined> {
        const conversation = await conversationsService.findByPageAndSender(pageId, senderId);
        if (!conversation?.originContentId) return undefined;

        const lookup = conversation.platform === 'instagram'
            ? db.select({ message: instagramMedia.caption, createdAt: instagramMedia.createdAt })
                .from(instagramMedia).where(eq(instagramMedia.id, conversation.originContentId))
            : db.select({ message: posts.message, createdAt: posts.createdTime })
                .from(posts).where(eq(posts.id, conversation.originContentId));

        const [row] = await lookup;
        if (!row?.message) return undefined;

        const postedAt = row.createdAt ?? null;
        if (!postedAt || Date.now() - postedAt.getTime() >= MAX_ORIGIN_POST_AGE_MS) {
            return undefined;
        }
        return row.message;
    }
}

export const messageProcessor = new MessageProcessor();

// --- Urgent notification helpers ---

// Re-export for backward compatibility (tests and other importers)
export { URGENT_FLAG_MAP, isUrgentFlag, buildNotificationReason } from './urgentFlags';
