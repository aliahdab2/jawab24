import { workspaceSettingsService } from '../workspaceSettings';
import { messagesService } from '../messages';
import { commentsService } from '../comments';
import { rateLimiter } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator, shouldSkipReply, shouldUseFallback, PRICE_FALLBACK } from './generator';
import { detectLanguageCode } from '../../utils/language';
import { integrationRegistry } from '../../integrations';
import { pipelineMetrics, Pipeline } from '../../lib/pipelineMetrics';
import { acquireReplyLock, releaseReplyLock } from '../../lib/replyLock';
import { Logger, noopLogger, CommentResult } from '../../types';
import type { CommentPlatformAdapter } from '../../interfaces';
import { formatBusinessProfile } from '../../utils/businessProfile';
import { truncateAtSentence } from '../../utils/text';
import { getStoreContextForAI } from '../ecommerce';
import { publishSSEEvent } from '../../lib/eventBus';
import { invalidateWorkspaceStatsCache } from '../pages';
import { subscriptionsService } from '../subscriptions';

/**
 * Unified Comment Processor
 *
 * Platform-agnostic pipeline for processing incoming comments.
 * All platform-specific behavior is injected via the adapter.
 *
 * Step order (normalized across all platforms):
 *  1. Validate page
 *  2. Check user settings (comments auto-reply)
 *  3. Find or create content (post/media)
 *  4. Store comment + check already replied/flagged
 *  4b. Acquire distributed lock (per-comment, prevents duplicate webhook replies)
 *  5. Handoff pause check
 *  6. Rate limit check
 *  7. Reply delay
 *  8. Generate reply
 *  8b. Replace with safe fallback for price_not_in_kb
 *  8c. Skip reply entirely for offensive content
 *  9. Handle no-reply (fallback or notify+return)
 * 10. Send reply
 * 11. Mark as replied
 * 12. Notify if flagged
 */
export class CommentProcessor {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
        rateLimiter.setLogger(logger);
        replyGenerator.setLogger(logger);
    }

    async processComment(
        adapter: CommentPlatformAdapter,
        platformPageId: string,
        contentId: string,
        platformCommentId: string,
        commentMessage: string,
        fromId?: string,
        fromName?: string,
    ): Promise<CommentResult> {
        const platform = adapter.platform;
        const pipeline = `${platform}_comment` as Pipeline;

        try {
            // 1. Validate page
            const page = await adapter.getPage(platformPageId);
            if (!page) {
                pipelineMetrics.record(pipeline, 'page_not_found');
                return { success: false, commentId: platformCommentId, error: 'Page not found' };
            }
            if (!page.autoReplyEnabled) {
                pipelineMetrics.record(pipeline, 'auto_reply_disabled');
                return { success: false, commentId: platformCommentId, error: 'Auto-reply disabled for this page' };
            }
            if (!page.userId) {
                pipelineMetrics.record(pipeline, 'no_user');
                return { success: false, commentId: platformCommentId, error: 'Page has no associated user' };
            }
            if (!page.workspaceId) {
                pipelineMetrics.record(pipeline, 'no_workspace');
                return { success: false, commentId: platformCommentId, error: 'Page has no associated workspace' };
            }
            const userId = page.userId;
            const workspaceId = page.workspaceId;

            // 2. Load workspace settings (cached in Redis)
            const userSettings = await workspaceSettingsService.getSettings(workspaceId);
            const isCommentsEnabled = workspaceSettingsService.isAutoReplyEnabledFromSettings(userSettings, 'comments');

            // 3. Find or create content entity (post/media)
            const content = await adapter.findOrCreateContent(page.id, contentId);
            if (!content.autoReplyEnabled) {
                pipelineMetrics.record(pipeline, 'post_disabled');
                // Store comment even if content is disabled (preserves Instagram behavior)
                await adapter.storeComment(content.id, platformCommentId, commentMessage, fromId, fromName);
                return { success: false, commentId: platformCommentId, error: 'Auto-reply disabled for this content' };
            }

            // 4. Store the comment
            const { comment, isNew } = await adapter.storeComment(
                content.id, platformCommentId, commentMessage, fromId, fromName,
            );

            // 4a. If fromName is missing, try fetching from the platform API (best-effort)
            if (!fromName && adapter.fetchCommenterName && page.accessToken) {
                try {
                    const fetchedName = await adapter.fetchCommenterName(platformCommentId, page.accessToken);
                    if (fetchedName) {
                        fromName = fetchedName;
                        await commentsService.updateComment(comment.id, { fromName: fetchedName });
                    }
                } catch {
                    // Non-critical — continue without name
                }
            }

            // SSE: notify merchant that a new comment arrived
            publishSSEEvent(userId, 'comment:received', {
                commentId: comment.id,
                pageId: page.id,
                fromName: fromName ?? null,
                message: commentMessage,
            });

            // Invalidate dashboard stats so next load reflects the new comment
            invalidateWorkspaceStatsCache(workspaceId);

            // Early exit: settings disabled (after storing so the comment is persisted)
            if (!isCommentsEnabled) {
                pipelineMetrics.record(pipeline, 'settings_disabled');
                return { success: false, commentId: comment.id, error: 'Comments auto-reply disabled' };
            }

            // Early exit: already replied or already flagged
            if (!isNew && (comment.replied || comment.needsAttention)) {
                pipelineMetrics.record(pipeline, 'already_replied');
                return { success: false, commentId: comment.id, error: 'Comment already replied' };
            }

            // 4a. Subscription gate — send away message instead of AI reply for expired subscriptions
            const isActive = await subscriptionsService.isSubscriptionActive(userId);
            if (!isActive) {
                pipelineMetrics.record(pipeline, 'subscription_inactive');
                this.logger.info(`[${platform}] Subscription inactive — sending away message fallback`, { userId, pageId: page.id });

                // Send away message so the customer isn't left hanging
                const customerLang = detectLanguageCode(commentMessage);
                const awayMessage = await workspaceSettingsService.getAwayMessage(workspaceId, customerLang);
                if (awayMessage && page.accessToken) {
                    try {
                        await adapter.sendReply({
                            platformCommentId,
                            platformPageId,
                            replyText: awayMessage,
                            commentMessage,
                            accessToken: page.accessToken,
                            fromId,
                            userSettings: userSettings as unknown as Record<string, unknown>,
                        });
                        await commentsService.markAsReplied(comment.id, awayMessage, 'template');
                        this.logger.info(`[${platform}] Sent away message for inactive subscription`, { commentId: comment.id });
                    } catch (error) {
                        this.logger.error(`[${platform}] Failed to send away message for inactive subscription`, { error: String(error) });
                        // Flag so merchant sees it needs attention
                        await adapter.flagComment(comment.id, 'subscription_inactive');
                    }
                } else {
                    // No away message configured — flag for manual attention
                    await adapter.flagComment(comment.id, 'subscription_inactive');
                }

                return { success: false, commentId: comment.id, error: 'Subscription inactive' };
            }

            // 4b. Acquire per-comment lock — prevents duplicate webhook replies
            const lockToken = await acquireReplyLock(`comment:${page.id}`, platformCommentId);
            if (!lockToken) {
                pipelineMetrics.record(pipeline, 'lock_contention');
                this.logger.info(`[${platform}] Comment lock held — another worker handling`, { platformCommentId });
                return { success: false, commentId: comment.id, error: 'Lock held by another worker' };
            }

            try {
            // 5-6. Run independent guard checks in parallel
            if (fromId) {
                const pauseMinutes = userSettings.handoffPauseDurationMinutes;
                const [isPaused, rateCheck] = await Promise.all([
                    messagesService.isPaused(page.id, fromId, pauseMinutes),
                    rateLimiter.check(page.id, fromId, 'comment'),
                ]);

                if (isPaused) {
                    const remainingMs = await messagesService.getRemainingPauseMs(page.id, fromId, pauseMinutes);
                    const delayMs = remainingMs > 0 ? remainingMs + 5000 : pauseMinutes * 60 * 1000;
                    pipelineMetrics.record(pipeline, 'handoff_active');
                    this.logger.info(`[${platform}] Comment handoff active — requesting re-enqueue`, {
                        fromId, pageId: page.id, delayMs,
                    });
                    return { success: false, commentId: comment.id, error: 'Handoff active', handoffDelayMs: delayMs };
                }

                if (!rateCheck.allowed) {
                    pipelineMetrics.record(pipeline, 'rate_limited');
                    this.logger.info(`[${platform}] Comment rate limited`, { fromId, count: rateCheck.count });
                    return { success: false, commentId: comment.id, error: 'Rate limited' };
                }
            } else {
                this.logger.debug(`[${platform}] Rate limit skipped — no fromId`, { platformCommentId });
            }

            // 7. Reply delay
            const replyDelay = userSettings.replyDelay;
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 8. Generate reply (enrich KB with e-commerce data if linked)
            const generatorContext = adapter.buildGeneratorContext(page, content, contentId);
            generatorContext.text = commentMessage;
            for (const integration of integrationRegistry.getEnabled()) {
                try {
                    const enriched = await integration.enrichKnowledgeBase(generatorContext.knowledgeBase, page as unknown as Record<string, unknown>);
                    if (enriched !== null) { generatorContext.knowledgeBase = enriched; break; }
                } catch { /* non-critical — continue with original KB */ }
            }

            // Fetch store policies + product catalog so they survive RAG mode (RAG drops static KB)
            const ecommerceStoreId = (page as unknown as Record<string, unknown>).ecommerceStoreId;
            if (ecommerceStoreId && typeof ecommerceStoreId === 'string') {
                try {
                    const storeCtx = await getStoreContextForAI(ecommerceStoreId);
                    generatorContext.storePolicies = storeCtx.storePolicies;
                    generatorContext.productCatalog = storeCtx.productCatalog;
                } catch { /* non-critical */ }
            }

            // Append business profile (hours, location, phone) to KB context
            const profileText = formatBusinessProfile(page.businessProfile);
            if (profileText) {
                generatorContext.knowledgeBase = generatorContext.knowledgeBase
                    ? `${generatorContext.knowledgeBase}\n\n--- Business Info ---\n${profileText}`
                    : profileText;
            }
            // Pass reply style settings to generator context
            generatorContext.replyStyle = userSettings.replyStyle;
            // Pick language-appropriate brand voice notes
            const bvMulti = (userSettings.brandVoiceNotesMulti || {}) as Record<string, string>;
            const commentLang = detectLanguageCode(commentMessage);
            const supportedLangs = (userSettings.supportedLanguages as string[] | undefined) || ['ar', 'en'];
            generatorContext.brandVoiceNotes = bvMulti[commentLang]
                || supportedLangs.map(l => bvMulti[l]).find(Boolean)
                || userSettings.brandVoiceNotes || undefined;

            const commentReplyMode = (userSettings.commentReplyMode as 'public' | 'private' | 'dual') || 'public';
            let { replyText: generatedText, replyMethod, templateId, needsAttention, flagReason, aiIntent, confidence } =
                await replyGenerator.generateForComment(generatorContext, userSettings.aiEnabled ?? false, commentReplyMode);

            // Capture the original AI-generated reply before any modifications (fallback, truncation, CTA)
            const aiOriginalReply = replyMethod === 'ai' ? (generatedText ?? undefined) : undefined;

            // 8b. Replace with safe fallback if AI hallucinated a price
            if (shouldUseFallback(flagReason)) {
                const detectedLang = detectLanguageCode(commentMessage);
                const lang = detectedLang === 'unknown' ? 'en' : detectedLang;
                generatedText = PRICE_FALLBACK[lang] || PRICE_FALLBACK['en'];
            }

            // 8c. Skip reply entirely for offensive content
            if (shouldSkipReply(flagReason, aiIntent)) {
                await adapter.flagComment(comment.id, flagReason, aiIntent);

                if (page.userId) {
                    notificationService.sendTemplateNotification(
                        page.userId,
                        'skipped_reply',
                        { senderName: fromName || 'Unknown', reason: flagReason || 'offensive' },
                        { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' },
                    ).catch(err => this.logger.error('Offensive comment notification failed', { err }));
                }
                pipelineMetrics.record(pipeline, 'skipped_risky');
                return { success: true, commentId: comment.id };
            }

            // 8d. Hold low-confidence replies for merchant review when enabled
            if (userSettings.holdLowConfidence && confidence === 'low' && replyMethod === 'ai') {
                const lang = detectLanguageCode(commentMessage);
                await adapter.markAsReplied(
                    comment.id, '', replyMethod,
                    lang === 'unknown' ? 'en' : lang,
                    undefined, true, 'held_low_confidence', aiIntent, aiOriginalReply,
                );
                if (page.userId) {
                    notificationService.sendTemplateNotification(
                        page.userId,
                        'flagged_reply',
                        { senderName: fromName || 'Unknown', reason: 'held_low_confidence' },
                        { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' },
                    ).catch(err => this.logger.error('Held reply notification failed', { err }));
                }
                pipelineMetrics.record(pipeline, 'held_low_confidence');
                return { success: true, commentId: comment.id };
            }

            // 9. Handle no-reply
            let replyText = generatedText;
            if (!replyText) {
                const fallback = adapter.getFallbackReply();
                if (fallback) {
                    replyText = fallback;
                } else {
                    // Notify user about pending comment
                    if (page.userId) {
                        notificationService.sendTemplateNotification(
                            page.userId,
                            'new_comment',
                            { senderName: fromName || 'Unknown' },
                            { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' },
                        ).catch(err => this.logger.error('New comment notification failed', { err }));
                    }
                    pipelineMetrics.record(pipeline, 'no_reply_generated');
                    return { success: false, commentId: comment.id, error: 'No reply generated' };
                }
            }

            // 9b. Enforce max length for public comment replies (280 chars, tweet-length)
            // Skip truncation for dual/private modes — the reply is sent as a DM where length is fine.
            if (commentReplyMode === 'public') {
                const MAX_COMMENT_REPLY_CHARS = 500;
                if (replyText.length > MAX_COMMENT_REPLY_CHARS) {
                    const originalLength = replyText.length;
                    replyText = truncateAtSentence(replyText, MAX_COMMENT_REPLY_CHARS);
                    this.logger.info('[CommentProcessor] Reply truncated to max length', {
                        originalLength,
                        truncatedLength: replyText.length,
                    });
                }
            }

            // 10. Send reply
            const sendResult = await adapter.sendReply({
                platformCommentId,
                platformPageId,
                replyText,
                commentMessage,
                accessToken: page.accessToken,
                fromId,
                userSettings: userSettings as unknown as Record<string, unknown>,
            });

            if (!sendResult.success) {
                pipelineMetrics.record(pipeline, 'send_failed');
                // SSE: notify merchant of failed reply
                publishSSEEvent(userId, 'comment:reply_failed', {
                    commentId: comment.id,
                    pageId: page.id,
                    error: sendResult.error || 'Failed to send reply',
                });
                return { success: false, commentId: comment.id, error: sendResult.error };
            }

            // 11. Mark as replied
            const detectedLanguage = detectLanguageCode(commentMessage);
            await adapter.markAsReplied(
                comment.id,
                replyText,
                replyMethod,
                detectedLanguage === 'unknown' ? 'en' : detectedLanguage,
                templateId,
                needsAttention,
                flagReason,
                aiIntent,
                aiOriginalReply,
            );

            // 12. Notify if flagged
            if (needsAttention && page.userId) {
                notificationService.sendTemplateNotification(
                    page.userId,
                    'flagged_reply',
                    { senderName: fromName || 'Unknown', reason: flagReason || 'AI flagged this reply' },
                    { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' },
                ).catch(err => this.logger.error('Flagged notification failed', { err }));
            }

            // SSE: notify merchant that a reply was sent
            publishSSEEvent(userId, 'comment:reply_sent', {
                commentId: comment.id,
                pageId: page.id,
                replyMethod: replyMethod as 'template' | 'ai',
                replyText,
            });
            // SSE: update usage counter if AI reply
            if (replyMethod === 'ai') {
                publishSSEEvent(userId, 'usage:updated', { aiRepliesUsed: -1 });
            }

            pipelineMetrics.record(pipeline, 'success');

            // Structured per-reply log — single line with all reply metadata
            this.logger.info(`[${platform}] reply_sent`, {
                event: 'reply_sent',
                pipeline,
                platform,
                pageId: page.id,
                commentId: comment.id,
                replyMethod,
                aiIntent,
                confidence,
                flagReason: flagReason || null,
                needsAttention,
                replyLength: replyText.length,
            });

            return { success: true, commentId: comment.id, replyText, replyMethod };

            } finally {
                await releaseReplyLock(`comment:${page.id}`, platformCommentId, lockToken).catch(() => { /* TTL will auto-expire */ });
            }

        } catch (error) {
            pipelineMetrics.record(pipeline, 'error');
            this.logger.error(`[${platform}] Error processing comment`, {
                platformCommentId,
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                success: false,
                commentId: platformCommentId,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const commentProcessor = new CommentProcessor();
