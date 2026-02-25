import { workspaceSettingsService } from '../workspaceSettings';
import { messagesService } from '../messages';
import { rateLimiter } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator, shouldSkipReply, shouldUseFallback, PRICE_FALLBACK } from './generator';
import { detectLanguageCode } from '../../utils/language';
import { integrationRegistry } from '../../integrations';
import { pipelineMetrics, Pipeline } from '../../lib/pipelineMetrics';
import { Logger, noopLogger, CommentResult } from '../../types';
import type { CommentPlatformAdapter } from '../../interfaces';
import { formatBusinessProfile } from '../../utils/businessProfile';
import { truncateAtSentence } from '../../utils/text';

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

            // 2. Check workspace settings
            const isCommentsEnabled = await workspaceSettingsService.isCommentsAutoReplyEnabled(workspaceId);

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

            // 5. Handoff pause check
            const userSettings = await workspaceSettingsService.getSettings(workspaceId);
            if (fromId) {
                const pauseMinutes = userSettings.handoffPauseDurationMinutes;
                const isPaused = await messagesService.isPaused(page.id, fromId, pauseMinutes);
                if (isPaused) {
                    const remainingMs = await messagesService.getRemainingPauseMs(page.id, fromId, pauseMinutes);
                    const delayMs = remainingMs > 0 ? remainingMs + 5000 : pauseMinutes * 60 * 1000;
                    pipelineMetrics.record(pipeline, 'handoff_active');
                    this.logger.info(`[${platform}] Comment handoff active — requesting re-enqueue`, {
                        fromId, pageId: page.id, delayMs,
                    });
                    return { success: false, commentId: comment.id, error: 'Handoff active', handoffDelayMs: delayMs };
                }
            }

            // 6. Rate limit check
            if (fromId) {
                const rateCheck = await rateLimiter.check(page.id, fromId, 'comment');
                if (!rateCheck.allowed) {
                    pipelineMetrics.record(pipeline, 'rate_limited');
                    this.logger.info(`[${platform}] Comment rate limited`, { fromId, count: rateCheck.count });
                    return { success: false, commentId: comment.id, error: 'Rate limited' };
                }
            } else {
                this.logger.debug(`[${platform}] Rate limit skipped — no fromId`, { platformCommentId });
            }

            // 7. Reply delay
            const replyDelay = await workspaceSettingsService.getReplyDelay(workspaceId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 8. Generate reply (enrich KB with e-commerce data if linked)
            const generatorContext = adapter.buildGeneratorContext(page, content, contentId);
            generatorContext.text = commentMessage;
            for (const integration of integrationRegistry.getEnabled()) {
                const enriched = await integration.enrichKnowledgeBase(generatorContext.knowledgeBase, page as unknown as Record<string, unknown>);
                if (enriched !== null) { generatorContext.knowledgeBase = enriched; break; }
            }

            // Append business profile (hours, location, phone) to KB context
            const profileText = formatBusinessProfile(page.businessProfile);
            if (profileText) {
                generatorContext.knowledgeBase = generatorContext.knowledgeBase
                    ? `${generatorContext.knowledgeBase}\n\n--- Business Info ---\n${profileText}`
                    : profileText;
            }
            const commentReplyMode = (userSettings.commentReplyMode as 'public' | 'private' | 'dual') || 'public';
            let { replyText: generatedText, replyMethod, templateId, needsAttention, flagReason, aiIntent } =
                await replyGenerator.generateForComment(generatorContext, userSettings.aiEnabled ?? false, commentReplyMode);

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
            const MAX_COMMENT_REPLY_CHARS = 280;
            if (replyText.length > MAX_COMMENT_REPLY_CHARS) {
                const originalLength = replyText.length;
                replyText = truncateAtSentence(replyText, MAX_COMMENT_REPLY_CHARS);
                this.logger.info('[CommentProcessor] Reply truncated to max length', {
                    originalLength,
                    truncatedLength: replyText.length,
                });
            }

            // 9c. Auto-append DM CTA for question/purchase intents (public mode only)
            if (commentReplyMode === 'public' && ['QUESTION', 'PURCHASE_INTENT'].includes(aiIntent || '')) {
                const hasDmMention = /\b(DM|message|رسالة|خاص|الخاص)\b/i.test(replyText);
                if (!hasDmMention) {
                    const lang = detectLanguageCode(commentMessage);
                    const cta = lang === 'ar' || /[\u0600-\u06FF]/.test(commentMessage)
                        ? '\nراسلنا على الخاص للمزيد من التفاصيل 📩'
                        : '\nSend us a message for more details 📩';
                    replyText = replyText.trimEnd() + cta;
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

            pipelineMetrics.record(pipeline, 'success');
            return { success: true, commentId: comment.id, replyText, replyMethod };

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
