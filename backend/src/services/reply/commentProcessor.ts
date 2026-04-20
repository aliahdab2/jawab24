import { workspaceSettingsService } from '../workspaceSettings';
import { messagesService } from '../messages';
import { commentsService } from '../comments';
import { rateLimiter } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator, shouldSkipReply, shouldSilentlySkip, shouldUseFallback, PRICE_FALLBACK, resolveFallbackLanguage } from './generator';
import { detectLanguageCode, detectCommentLanguage } from '../../utils/language';
import { hasUserTag } from '../../utils/commentText';
import { pipelineMetrics, Pipeline } from '../../lib/pipelineMetrics';
import { acquireReplyLock, releaseReplyLock } from '../../lib/replyLock';
import { Logger, noopLogger, CommentResult } from '../../types';
import type { CommentPlatformAdapter } from '../../interfaces';
import { truncateAtSentence } from '../../utils/text';
import { enrichPageContext } from './contextEnricher';
import { publishSSEEvent } from '../../lib/eventBus';
import { invalidateWorkspaceStatsCache } from '../pages';
import { subscriptionsService } from '../subscriptions';
import { matchesKeyword, normalizeArabic, parseKeywords } from '@jawab24/shared';
import { leadExtractorService } from '../leadExtractor';

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
        parentId?: string,
        messageTags?: import('../../utils/commentText').FacebookMessageTag[],
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
            const content = await adapter.findOrCreateContent(page.id, contentId, page.accessToken);
            if (!content.autoReplyEnabled) {
                pipelineMetrics.record(pipeline, 'post_disabled');
                // Store comment even if content is disabled (preserves Instagram behavior)
                await adapter.storeComment(content.id, workspaceId, platformCommentId, commentMessage, fromId, fromName, messageTags);
                return { success: false, commentId: platformCommentId, error: 'Auto-reply disabled for this content' };
            }

            // 3b. Per-post trigger check — fires before template/AI pipeline.
            // When a post has a triggerKeyword set, ONLY comments matching that keyword
            // get a reply (using triggerReply). Non-matching comments are silently skipped.
            // This mirrors the "comment X to get details" engagement tactic (ManyChat-style).
            // Respects isCommentsEnabled — if workspace auto-reply is off, triggers are also off.
            // Triggers fire on both top-level comments AND sub-comments (replies to pinned comments
            // are common in engagement posts like "comment . to get details").
            if (content.triggerKeyword && content.triggerReply && isCommentsEnabled) {
                const normalizedComment = normalizeArabic(commentMessage.toLowerCase());
                const triggerKeywords = parseKeywords(content.triggerKeyword);
                const matchedKeyword = triggerKeywords.find(kw =>
                    matchesKeyword(normalizedComment, normalizeArabic(kw.toLowerCase())),
                );

                if (matchedKeyword) {
                    // Comment matches a trigger keyword — send triggerReply immediately, skip template/AI
                    const { comment } = await adapter.storeComment(content.id, workspaceId, platformCommentId, commentMessage, fromId, fromName, messageTags);
                    invalidateWorkspaceStatsCache(workspaceId);
                    return this.sendAndFinalize({
                        adapter, platform, pipeline,
                        pageId: page.id, userId, workspaceId,
                        comment, replyText: content.triggerReply, replyMethod: 'template',
                        commentMessage, platformCommentId, platformPageId,
                        accessToken: page.accessToken, fromId, fromName,
                        userSettings: userSettings as unknown as Record<string, unknown>,
                        postMessage: content.message || undefined,
                        contentId: content.id,
                        triggerKeyword: matchedKeyword,
                    });
                }
                // No match — fall through to AI
                this.logger.info(`[${platform}] Trigger keywords set but comment did not match — falling through to AI`, {
                    platformCommentId, triggerKeywords,
                });
            } else if (content.triggerKeyword) {
                // Trigger keywords exist but conditions not met — log for diagnostics
                this.logger.info(`[${platform}] Trigger keywords exist but trigger block skipped`, {
                    platformCommentId,
                    hasTriggerReply: !!content.triggerReply,
                    isCommentsEnabled,
                });
            }

            // 4. Store the comment
            const { comment, isNew } = await adapter.storeComment(
                content.id, workspaceId, platformCommentId, commentMessage, fromId, fromName, messageTags,
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

            // 4a. Subscription gate — all automation stops when subscription is inactive
            const isActive = await subscriptionsService.isSubscriptionActive(userId);
            if (!isActive) {
                pipelineMetrics.record(pipeline, 'subscription_inactive');
                this.logger.info(`[${platform}] Subscription inactive — skipping reply`, { userId, pageId: page.id });
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
            const enriched = await enrichPageContext(
                page as unknown as Record<string, unknown>,
                userSettings,
                commentMessage,
                generatorContext.knowledgeBase,
            );
            generatorContext.knowledgeBase = enriched.knowledgeBase;
            generatorContext.storePolicies = enriched.storePolicies;
            generatorContext.productCatalog = enriched.productCatalog;
            generatorContext.brandVoiceNotes = enriched.brandVoiceNotes;
            generatorContext.replyStyle = userSettings.replyStyle;
            generatorContext.defaultReplyLanguage = userSettings.defaultReplyLanguage;
            // Pass commenter name so the AI addresses the actual commenter, not a tagged person
            generatorContext.senderName = fromName ?? undefined;
            // Facebook `message_tags` + our page id — feeds the user-tag skip rule
            // (see commentPreprocess.preprocessCommentText). Only Facebook comments
            // carry tags; Instagram webhooks don't provide them, so both fields stay
            // undefined and the skip rule becomes a no-op for non-FB platforms.
            // Coupling: assumes `platformPageId` is the Facebook numeric page id for
            // the facebook platform — true today for the webhook path (see
            // webhook.ts#processNewComment) and the worker path (replyWorker.ts).
            // If a new FB-like platform reuses the `'facebook'` platform tag but
            // passes a different id shape, revisit this assignment.
            generatorContext.messageTags = messageTags;
            generatorContext.ourFacebookPageId = platform === 'facebook' ? platformPageId : undefined;

            const commentReplyMode = (userSettings.commentReplyMode as 'public' | 'private' | 'dual') || 'public';
            let { replyText: generatedText, replyMethod, needsAttention, flagReason, aiIntent, confidence } =
                await replyGenerator.generateForComment(generatorContext, userSettings.aiEnabled ?? false, commentReplyMode);

            // Capture the original AI-generated reply before any modifications (fallback, truncation, CTA)
            const aiOriginalReply = replyMethod === 'ai' ? (generatedText ?? undefined) : undefined;

            // 8b. Replace with safe fallback if AI hallucinated a price
            if (shouldUseFallback(flagReason)) {
                const lang = resolveFallbackLanguage({
                    text: commentMessage,
                    postMessage: content.message || undefined,
                    knowledgeBase: generatorContext.knowledgeBase,
                    defaultReplyLanguage: userSettings.defaultReplyLanguage,
                });
                generatedText = PRICE_FALLBACK[lang];
            }

            // 8c. Skip reply — silent for spam/tags, flagged for offensive content
            if (shouldSkipReply(flagReason, aiIntent)) {
                if (shouldSilentlySkip(aiIntent)) {
                    // Spam/irrelevant (tagging someone, emoji-only, etc.) — no flag, no notification.
                    // Resolve so the comment doesn't remain as "pending" in the merchant's view.
                    await commentsService.resolveComment(comment.id);
                    // Reason classification drives the frontend label ("Friend tag" vs
                    // generic "Skipped"). User-tag skips are the common case post-2026-04-20;
                    // other SPAM_OR_IRRELEVANT classifications fall through as 'spam'.
                    const skipReason: 'friend_tag' | 'spam' = hasUserTag(messageTags) ? 'friend_tag' : 'spam';
                    invalidateWorkspaceStatsCache(workspaceId);
                    publishSSEEvent(userId, 'comment:skipped', {
                        commentId: comment.id,
                        pageId: page.id,
                        reason: skipReason,
                        ...(flagReason ? { flagReason } : {}),
                    });
                    pipelineMetrics.record(pipeline, 'skipped_spam');
                    this.logger.info(`[${platform}] Comment silently skipped as spam/irrelevant`, {
                        commentId: comment.id, platformCommentId, aiIntent, commentMessage, skipReason,
                    });
                    return { success: true, commentId: comment.id };
                }

                // Offensive: flag for merchant attention (needsAttention=true, NOT resolved).
                // Do NOT emit comment:skipped — the frontend handler would mark the comment
                // resolved, contradicting the flagged state. The existing notification
                // pipeline handles the merchant's inbox update.
                await adapter.flagComment(comment.id, flagReason, aiIntent);

                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'skipped_reply',
                    { senderName: fromName || 'Unknown', reason: flagReason || 'offensive' },
                    { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' },
                ).catch(err => this.logger.error('Offensive comment notification failed', { err }));
                pipelineMetrics.record(pipeline, 'skipped_risky');
                return { success: true, commentId: comment.id };
            }

            // 8d. Hold low-confidence replies for merchant review when enabled
            if (userSettings.holdLowConfidence && confidence === 'low' && replyMethod === 'ai') {
                const lang = detectLanguageCode(commentMessage);
                await adapter.markAsReplied(
                    comment.id, '', replyMethod,
                    lang === 'unknown' ? 'en' : lang,
                    true, 'held_low_confidence', aiIntent, aiOriginalReply,
                );
                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'flagged_reply',
                    { senderName: fromName || 'Unknown', reason: 'held_low_confidence' },
                    { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' },
                ).catch(err => this.logger.error('Held reply notification failed', { err }));
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
                    notificationService.sendTemplateNotificationToWorkspace(
                        workspaceId,
                        'new_comment',
                        { senderName: fromName || 'Unknown' },
                        { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' },
                    ).catch(err => this.logger.error('New comment notification failed', { err }));
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

            // 10-12. Send reply, mark as replied, fire SSE events + metrics
            if (needsAttention) {
                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'flagged_reply',
                    { senderName: fromName || 'Unknown', reason: flagReason || 'AI flagged this reply' },
                    { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' },
                ).catch(err => this.logger.error('Flagged notification failed', { err }));
            }

            return this.sendAndFinalize({
                adapter, platform, pipeline,
                pageId: page.id, userId, workspaceId,
                comment, replyText, replyMethod, commentMessage,
                platformCommentId, platformPageId,
                accessToken: page.accessToken, fromId, fromName,
                userSettings: userSettings as unknown as Record<string, unknown>,
                postMessage: content.message || undefined,
                contentId: content.id,
                needsAttention, flagReason, aiIntent, aiOriginalReply,
                confidence,
            });

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

    /**
     * Send a reply and record all side-effects: mark-as-replied, SSE events,
     * pipeline metrics, and structured log. Shared by the trigger path and
     * the main template/AI path to avoid duplicating these ~20 lines.
     */
    private async sendAndFinalize(opts: {
        adapter: CommentPlatformAdapter;
        platform: string;
        pipeline: Pipeline;
        pageId: string;
        userId: string;
        workspaceId: string;
        comment: { id: string };
        replyText: string;
        replyMethod: 'template' | 'ai';
        commentMessage: string;
        platformCommentId: string;
        platformPageId: string;
        accessToken: string;
        fromId?: string;
        fromName?: string;
        userSettings: Record<string, unknown>;
        postMessage?: string;
        /** The originating post/media UUID. Persisted on the conversation so
         *  follow-up DMs can inherit post context (see messageProcessor). */
        contentId: string;
        needsAttention?: boolean;
        flagReason?: string;
        aiIntent?: string;
        aiOriginalReply?: string;
        confidence?: string;
        triggerKeyword?: string;
    }): Promise<CommentResult> {
        const {
            adapter, platform, pipeline, pageId, userId, workspaceId,
            comment, replyText, replyMethod, commentMessage,
            platformCommentId, platformPageId, accessToken, fromId, fromName, userSettings,
            contentId, needsAttention, flagReason, aiIntent, aiOriginalReply,
            confidence, triggerKeyword,
        } = opts;

        const sendResult = await adapter.sendReply({
            platformCommentId,
            platformPageId,
            replyText,
            commentMessage,
            accessToken,
            fromId,
            userSettings,
            postMessage: opts.postMessage,
        });

        if (!sendResult.success) {
            pipelineMetrics.record(pipeline, 'send_failed');
            publishSSEEvent(userId, 'comment:reply_failed', {
                commentId: comment.id,
                pageId,
                error: sendResult.error || 'Failed to send reply',
            });
            return { success: false, commentId: comment.id, error: sendResult.error };
        }

        // Store outgoing DM so conversation history exists for future messages from this sender.
        // Pass fromName — the commenter's display name from the webhook — so the conversation's
        // senderName is filled in even when the customer only commented (never DM'd us first).
        // Without this, comment-triggered DMs surfaced as "Unknown User" in the inbox.
        if (sendResult.dmRecipientId) {
            messagesService.storeOutgoingMessage(
                pageId, workspaceId, sendResult.dmRecipientId, replyText,
                replyMethod as 'template' | 'ai' | 'manual',
                undefined, fromName, contentId,
            )
                .catch(err => this.logger.error('[CommentProcessor] Failed to store outgoing DM', { err, pageId, fromId }));
        }

        // Detect language from comment, falling back to post language for punctuation-only comments
        const detectedLanguage = detectCommentLanguage(commentMessage, opts.postMessage);
        await adapter.markAsReplied(
            comment.id,
            replyText,
            replyMethod,
            detectedLanguage === 'unknown' ? 'en' : detectedLanguage,
            needsAttention,
            flagReason,
            aiIntent,
            aiOriginalReply,
        );

        publishSSEEvent(userId, 'comment:reply_sent', {
            commentId: comment.id,
            pageId,
            replyMethod: replyMethod as 'template' | 'ai',
            replyText,
            senderName: fromName ?? null,
        });

        if (replyMethod === 'ai') {
            publishSSEEvent(userId, 'usage:updated', { aiRepliesUsed: -1 });
        }

        // Fire-and-forget lead extraction (non-critical — never blocks reply pipeline)
        leadExtractorService.maybeCaptureLead({
            pageId,
            userId,
            workspaceId,
            sourceId: comment.id,
            sourceType: 'comment',
            senderId: fromId ?? '',
            senderName: fromName,
            messageText: commentMessage,
        }).catch(() => { /* errors captured inside maybeCaptureLead */ });

        pipelineMetrics.record(pipeline, 'success');

        this.logger.info(`[${platform}] reply_sent`, {
            event: 'reply_sent',
            pipeline,
            platform,
            pageId,
            commentId: comment.id,
            replyMethod,
            ...(triggerKeyword ? { triggerKeyword } : { aiIntent, confidence, flagReason: flagReason || null, needsAttention }),
            replyLength: replyText.length,
        });

        return { success: true, commentId: comment.id, replyText, replyMethod };
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const commentProcessor = new CommentProcessor();
