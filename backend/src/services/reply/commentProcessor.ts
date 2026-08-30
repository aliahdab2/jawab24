import { workspaceSettingsService } from '../workspaceSettings';
import { messagesService } from '../messages';
import { commentsService } from '../comments';
import { rateLimiter, commentDebounce, postReplyCap } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator, shouldSkipReply, shouldSilentlySkip, shouldUseFallback, shouldHoldReply, PRICE_FALLBACK, resolveFallbackLanguage } from './generator';
import { isUrgentNotification, buildNotificationReason, detectBusinessActionFlags } from './urgentFlags';
import { resolvePostReplyRule, matchPostReplyRule, evaluateAnyCommentGuard } from './postReplyRule';
import { isWithinBusinessHours } from '../../utils/settingsHelpers';
import { preprocessCommentText } from './commentPreprocess';
import { UNINVITED_SYMBOL_SKIP, type UninvitedSymbolSkip } from './commentCta';
import { contentCtaClassifier } from '../contentCtaClassifier';
import { classifyFallbackIntent } from './fallbackClassifier';
import { detectLanguageCode, detectCommentLanguage } from '../../utils/language';
import { resolveEffectiveReplyMode, toReplyMode, unwrapBusinessProfile, hasRoutableContactChannel, isIdentityVerificationTurn } from '@jawab24/shared';
import { hasUserTag, hasOwnPageTag, isConfidentlyNotATag, isContentFree } from '../../utils/commentText';
import { isDemoPlatformId } from '../../utils/demo';
import { pipelineMetrics, Pipeline } from '../../lib/pipelineMetrics';
import { acquireReplyLock, releaseReplyLock } from '../../lib/replyLock';
import { Logger, noopLogger, CommentResult } from '../../types';
import type { CommentPlatformAdapter } from '../../interfaces';
import { truncateAtSentence } from '../../utils/text';
import { enrichPageContext } from './contextEnricher';
import { computeHumanDelayMs } from './humanDelay';
import { publishSSEEvent } from '../../lib/eventBus';
import { invalidateWorkspaceStatsCache } from '../pages';
import { subscriptionsService } from '../subscriptions';
import { leadExtractorService } from '../leadExtractor';
import { groundingVerifierService, buildGroundingSource } from '../groundingVerifier';
import { recordActivationEvent } from '../activation';
import { recordSendFailure, recordSendSuccess } from '../pageAutoPause';
import { withPageTokenRetryResult } from '../pageTokenRecovery';
import {
    isTransientFbError,
    isTransientAiError,
    needsImmediateAttention,
    AiRefusalError,
    buildDmFailedFlagMeta,
} from '../../utils/fbGraphErrors';
import { PostNotOwnedError } from '../postErrors';
import { captureError } from '../../utils/sentryHelpers';

/** Backstop for the smart-reply auto-like (workspace `likeComments` setting): never
 *  like a complaint, abuse, or spam comment — a page liking «طلبي ما وصل» reads as
 *  mockery. On the AI path this set is nearly redundant: computeNeedsAttention already
 *  forces needsAttention=true for every COMPLAINT/OFFENSIVE, and the like's
 *  !needsAttention clause suppresses those. It exists to pin the invariant
 *  independently of that function's future shape. Post Reply's per-post toggle needs
 *  no such guard: keyword-triggered commenters are self-selected interested buyers. */
const NO_AUTO_LIKE_INTENTS: ReadonlySet<string> = new Set(['COMPLAINT', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT']);

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
        commentDebounce.setLogger(logger);
        postReplyCap.setLogger(logger);
        replyGenerator.setLogger(logger);
        contentCtaClassifier.setLogger(logger);
    }

    constructor() {
        // D-111: every gate decision on a content-free comment lands here — the
        // pipeline counter and the per-post tally — because this file owns
        // pipelineMetrics and the generator must not import it (see CtaGateObserver).
        // Recorded at decision time, so a later AI failure cannot lose a shadow count.
        // Guarded because several suites automock the generator module (no setter).
        if (typeof replyGenerator.setCtaGateObserver !== 'function') return;
        replyGenerator.setCtaGateObserver((platform, contentId, decision) => {
            if (decision.action === 'skip') {
                pipelineMetrics.record(`${platform}_comment`, 'skipped_uninvited_symbol');
                contentCtaClassifier.recordGateOutcome(contentId, 'skip');
            } else if (decision.action === 'shadow_skip') {
                pipelineMetrics.record(`${platform}_comment`, 'cta_gate_shadow_skip');
                contentCtaClassifier.recordGateOutcome(contentId, 'shadow_skip');
            }
        });
    }

    /**
     * Resolve the comment, refresh dashboard stats, and emit `comment:skipped`
     * so the frontend flips the card from "Pending" to "Resolved" in real time.
     * Caller is responsible for the pipeline metric + log — those differ per exit.
     */
    private async silentlyResolveAndSkip(
        comment: { id: string },
        pageId: string,
        userId: string,
        workspaceId: string,
        reason: 'friend_tag' | 'spam' | 'offensive' | 'debounced' | UninvitedSymbolSkip,
        flagReason?: string,
    ): Promise<void> {
        await commentsService.resolveComment(comment.id);
        invalidateWorkspaceStatsCache(workspaceId);
        publishSSEEvent(userId, 'comment:skipped', {
            commentId: comment.id,
            pageId,
            reason,
            ...(flagReason ? { flagReason } : {}),
        });
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

        // Per-(page, post, sender) debounce slot. Claimed atomically before reply
        // generation (see step 3ab) and released in the outer `finally` on any
        // outcome that did NOT send a reply — so a BullMQ retry or the sender's
        // next genuine comment isn't wrongly debounced. A committed successful
        // send leaves `replyCommitted` true so the slot is kept for the window.
        let releaseDebounceSlot: (() => Promise<void>) | null = null;
        let replyCommitted = false;

        try {
            // 1. Validate page
            const page = await adapter.getPage(platformPageId);
            if (!page) {
                pipelineMetrics.record(pipeline, 'page_not_found');
                return { success: false, commentId: platformCommentId, error: 'Page not found' };
            }
            if (!page.autoReplyEnabled) {
                pipelineMetrics.record(pipeline, 'auto_reply_disabled');
                // SYSTEM-disabled pages still ingest the comment: the merchant never
                // chose to silence this page, so the comment must surface unreplied
                // in the inbox instead of vanishing. Ingestion only — no access token
                // is passed, so content creation is a stub row with no Graph API
                // fetch, and no AI runs. Reasons: 'trial_block' (anti-abuse guard),
                // 'auto_pause' (send-failure pause), 'plan_limit' (reserved — no
                // current writer; honored for support backfills of legacy shadow
                // pages). Merchant-toggled pages ('user', or null = pre-column
                // legacy) stay fully silent: the merchant said "leave this page
                // alone". DMs intentionally differ (always stored) — see
                // messageProcessor step 3.
                const systemDisabled = page.autoReplyDisabledReason === 'plan_limit'
                    || page.autoReplyDisabledReason === 'trial_block'
                    || page.autoReplyDisabledReason === 'auto_pause';
                if (systemDisabled && page.workspaceId) {
                    try {
                        const content = await adapter.findOrCreateContent(page.id, contentId);
                        await adapter.storeComment(content.id, page.workspaceId, platformCommentId, commentMessage, fromId, fromName, messageTags);
                        invalidateWorkspaceStatsCache(page.workspaceId);
                    } catch (storeError) {
                        // Ingestion is best-effort: a storage failure must not turn
                        // the deterministic "disabled page" skip into a retryable
                        // job error (the reply outcome is identical either way).
                        this.logger.error('Failed to ingest comment for system-disabled page', {
                            platformCommentId,
                            pageId: page.id,
                            error: storeError instanceof Error ? storeError.message : String(storeError),
                        });
                    }
                }
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
            // Resolved once — five call sites re-derived it, and the `reply_sent`
            // line could not report it at all. See messageProcessor for why that
            // matters: no reply record carried its mode, so D-087's owed weekly
            // measurement had no substrate for the comment surface either.
            const effectiveReplyMode = resolveEffectiveReplyMode(page.replyMode, userSettings.replyMode);

            // 3. Find or create content entity (post/media)
            let content: Awaited<ReturnType<typeof adapter.findOrCreateContent>>;
            try {
                content = await adapter.findOrCreateContent(page.id, contentId, page.accessToken);
            } catch (contentError) {
                // The post id resolves to a row owned by ANOTHER page. `posts.facebook_post_id`
                // is globally unique, so we can neither adopt the row nor insert our own —
                // this comment cannot be ingested at all. Deterministic: retrying produces
                // the same failure, so no rethrow. Handled explicitly instead of falling
                // through the generic catch, because a comment disappearing with only a
                // generic "Error processing comment" line is how the 2026-05-14 silent-drop
                // incident stayed invisible.
                if (contentError instanceof PostNotOwnedError) {
                    pipelineMetrics.record(pipeline, 'content_not_owned');
                    captureError(contentError, 'Comment dropped: post id belongs to another page', {
                        level: 'error',
                        fingerprint: ['comment-content-not-owned'],
                        tags: { pageId: page.id, platform },
                        extra: { pageId: page.id, contentId, platformCommentId },
                    });
                    return { success: false, commentId: platformCommentId, error: 'Post belongs to another page' };
                }
                throw contentError;
            }
            if (!content.autoReplyEnabled) {
                pipelineMetrics.record(pipeline, 'post_disabled');
                // Store comment even if content is disabled (preserves Instagram behavior)
                await adapter.storeComment(content.id, workspaceId, platformCommentId, commentMessage, fromId, fromName, messageTags);
                return { success: false, commentId: platformCommentId, error: 'Auto-reply disabled for this content' };
            }

            // Post Reply eligibility (D-027): a merchant-configured trigger on this
            // post fires regardless of the workspace auto-reply master — the master
            // gates the AI (D-025's hallucination rationale), not the merchant's own
            // verbatim template. Post Reply is designed always-on: configuring a
            // trigger IS the merchant's consent. Business hours still apply —
            // scheduling is a deliberate merchant choice orthogonal to AI risk.
            // Resolved here (pure, no I/O) so the debounce claim below can cover
            // Post-Reply-eligible comments even when the master is off.
            const postReplyRule = resolvePostReplyRule({
                triggerKeyword: content.triggerKeyword ?? null,
                triggerReply: content.triggerReply ?? null,
                triggerType: content.triggerType ?? 'keyword',
                triggerExcludeKeyword: content.triggerExcludeKeyword ?? null,
                triggerButtonLabel: content.triggerButtonLabel ?? null,
                triggerButtonUrl: content.triggerButtonUrl ?? null,
                triggerImageUrl: content.triggerImageUrl ?? null,
                likeComment: content.likeComment,
                tagCommenter: content.tagCommenter,
            });
            // Rule check first: most comments land on posts with no trigger, so the
            // business-hours evaluation (an Intl.DateTimeFormat construction) only
            // runs when a trigger actually exists.
            const postReplyEligible = !!postReplyRule
                && (!userSettings.businessHoursOnly
                    || isWithinBusinessHours(
                        userSettings.businessHoursStart,
                        userSettings.businessHoursEnd,
                        userSettings.timezone,
                    ));

            // 3a. Friend-tag silent-skip — must run before the trigger-keyword branch.
            // The AI path already skips user-tagged comments via preprocessCommentText,
            // but trigger keywords fire earlier and bypassed that guard: a comment like
            // "@Ali Ahdab تفاصيل" would match a "تفاصيل" trigger and send both a public
            // reply and a DM, even though the commenter was addressing a friend, not us.
            // Short-circuiting here covers both paths in one place.
            // Exception: if one of the tags points at our own page, the commenter IS
            // addressing us (alongside a friend) — let the normal pipeline handle it.
            // Instagram webhooks don't carry message_tags, so this is a no-op there.

            // Facebook webhooks inconsistently deliver `message_tags` even when the
            // comment carries a real structured user tag (confirmed on Graph API v23
            // in prod). When the webhook is silent AND the text doesn't clearly rule
            // out a tag (questions, prices, URLs — see isConfidentlyNotATag; length is
            // deliberately NOT a signal, it leaked a public reply on Shahin Resort),
            // fetch authoritative tags from Graph API before the guard runs. Bias:
            // fail toward fetching rather than toward replying — a wrong reply is
            // visible, a wasted fetch is cheap. BullMQ dedup upstream already makes
            // this effectively once-per-comment, so no extra caching layer needed.
            if (
                platform === 'facebook'
                && (!messageTags || messageTags.length === 0)
                && !isConfidentlyNotATag(commentMessage)
                && page.accessToken
                && adapter.fetchCommentWithTags
            ) {
                const fetched = await adapter.fetchCommentWithTags(platformCommentId, page.accessToken);
                if (fetched?.message_tags?.length) {
                    messageTags = fetched.message_tags;
                    this.logger.info(`[${platform}] message_tags recovered from Graph API`, {
                        platformCommentId, tagCount: fetched.message_tags.length,
                    });
                }
            }

            if (platform === 'facebook'
                && hasUserTag(messageTags)
                && !hasOwnPageTag(messageTags, platformPageId)) {
                const { comment } = await adapter.storeComment(
                    content.id, workspaceId, platformCommentId, commentMessage, fromId, fromName, messageTags,
                );
                invalidateWorkspaceStatsCache(workspaceId);
                publishSSEEvent(userId, 'comment:received', {
                    commentId: comment.id,
                    pageId: page.id,
                    fromName: fromName ?? null,
                    message: commentMessage,
                });
                // Through the shared helper, not a hand-rolled resolve + SSE pair: the two
                // spam skips below already use it, and the sequence had drifted into a
                // third copy here.
                await this.silentlyResolveAndSkip(comment, page.id, userId, workspaceId, 'friend_tag');
                // NOT `skipped_spam` — see the note on the Outcome union. This class is ~4,700
                // comments a month and D-108 deliberately widened it; pooled with AI-classified
                // spam, neither number could be read.
                pipelineMetrics.record(pipeline, 'skipped_friend_tag');
                this.logger.info(`[${platform}] Comment silently skipped — user-tag without own page-tag`, {
                    commentId: comment.id, platformCommentId, commentMessage,
                });
                return { success: true, commentId: comment.id };
            }

            // 3aa. Subscription gate — runs before ALL reply paths (Post Reply, AI, away).
            // Blocks canceled / paused / past_due-beyond-grace subscriptions so deterministic
            // keyword-match replies don't continue firing for free after a merchant cancels.
            // Dispatches a one-per-24h notification via enforceAutoReplyGate.
            const subGate = await subscriptionsService.enforceAutoReplyGate(userId);
            if (!subGate.allowed) {
                pipelineMetrics.record(pipeline, 'subscription_inactive');
                this.logger.info(`[${platform}] Subscription inactive — skipping all reply paths`, {
                    userId, pageId: page.id, reason: subGate.reason,
                });
                return { success: false, commentId: platformCommentId, error: 'Subscription inactive' };
            }

            // 3ab. Per-(page, post, sender) debounce — atomically CLAIM the reply
            // slot for this commenter on this post. If the slot is already held,
            // this commenter already received (or is mid-flight receiving) an
            // auto-reply on this post inside the window, so silently skip. Catches
            // accidental double-comments and back-to-back duplicates (e.g. "..",
            // "...") that would otherwise each fire a fresh AI reply. Claiming
            // atomically (not arming after send) closes the race where a burst of
            // comments all passed a read-only check before any armed the key.
            // Distinct from the per-comment idempotency lock, which only dedupes
            // the same comment_id. Distinct from the rate limiter, which counts
            // comments per sender across all posts. Skipped when fromId is missing
            // (pre-registered fan posts) — there's nothing to key on. Applies to
            // AI, trigger, and template paths uniformly — including master-off
            // Post Reply sends (D-027), which must debounce exactly like any other
            // reply. The slot is released in the outer `finally` unless a reply
            // was actually sent.
            if (fromId && (isCommentsEnabled || postReplyEligible)) {
                const senderId = fromId;
                const debounceToken = await commentDebounce.tryAcquire(page.id, content.id, senderId);
                if (!debounceToken) {
                    const { comment, isNew } = await adapter.storeComment(
                        content.id, workspaceId, platformCommentId, commentMessage, fromId, fromName, messageTags,
                    );
                    // True webhook duplicate for the SAME comment_id (not a separate
                    // back-to-back comment): defer to the existing already_replied
                    // path so observability stays clean — duplicate webhooks should
                    // not surface as "debounced", they were never going to reply.
                    if (!isNew && (comment.replied || comment.needsAttention)) {
                        pipelineMetrics.record(pipeline, 'already_replied');
                        return { success: false, commentId: comment.id, error: 'Comment already replied' };
                    }
                    publishSSEEvent(userId, 'comment:received', {
                        commentId: comment.id,
                        pageId: page.id,
                        fromName: fromName ?? null,
                        message: commentMessage,
                    });
                    await this.silentlyResolveAndSkip(comment, page.id, userId, workspaceId, 'debounced', 'recent_reply_to_same_sender_on_post');
                    pipelineMetrics.record(pipeline, 'debounce_skipped');
                    this.logger.info(`[${platform}] Comment debounced — same sender replied to on this post within cooldown`, {
                        commentId: comment.id, platformCommentId, pageId: page.id, postId: content.id, fromId,
                    });
                    return { success: true, commentId: comment.id };
                }
                // Won the slot — release it on any exit that doesn't send a reply.
                releaseDebounceSlot = () => commentDebounce.release(page.id, content.id, senderId, debounceToken);
            }

            // 3b. Post Reply trigger — fires before the template/AI pipeline.
            // A post's trigger fires on either specific keywords ('keyword') or any
            // comment ('all'); matching comments get the merchant's template immediately
            // (replyMethod 'post_reply'). Non-matching comments on a KEYWORD rule FALL
            // THROUGH to the AI pipeline — real questions on a keyword-configured post
            // still deserve an answer. This mirrors the "comment X to get details"
            // engagement tactic (ManyChat-style) without silencing off-keyword customers.
            // See postReplyRule.ts.
            // D-027: deliberately NOT gated on isCommentsEnabled — the workspace
            // master gates the AI; a merchant-configured trigger is explicit consent
            // and fires on its own (still behind the page/post toggles, subscription
            // gate, business hours, and the any-comment guards below).
            if (postReplyEligible && postReplyRule) {
                const rule = postReplyRule;  // narrowed alias: the guard above proves non-null
                const match = matchPostReplyRule(rule, commentMessage);
                if (match.matched) {
                    const { comment, isNew: triggerIsNew } = await adapter.storeComment(
                        content.id, workspaceId, platformCommentId, commentMessage, fromId, fromName, messageTags,
                    );
                    invalidateWorkspaceStatsCache(workspaceId);
                    // Mirror the AI path: announce the new comment so the frontend adds it
                    // to its list cache. Without this, the subsequent `comment:reply_sent`
                    // patches a cache entry that doesn't exist yet, and a later send
                    // failure leaves a ghost comment stuck as "Waiting to reply".
                    publishSSEEvent(userId, 'comment:received', {
                        commentId: comment.id,
                        pageId: page.id,
                        fromName: fromName ?? null,
                        message: commentMessage,
                    });

                    // Idempotency guard: a duplicate webhook would otherwise race itself.
                    // MUST run before the any-comment guard below — a redelivery of an
                    // already-flagged comment would otherwise re-run the guard and fire a
                    // duplicate flag + merchant notification on every redelivery.
                    if (!triggerIsNew && (comment.replied || comment.needsAttention)) {
                        pipelineMetrics.record(pipeline, 'already_replied');
                        return { success: false, commentId: comment.id, error: 'Comment already replied' };
                    }
                    // Per-comment lock — prevents duplicate webhook races from issuing two
                    // Graph API replies (FB rejects the second, leaving the comment stuck
                    // Pending even though the real reply landed). The any-comment guard's
                    // flag/skip actions run inside the lock too, mirroring the AI path
                    // (step 4b), so concurrent deliveries can't double-flag either.
                    const triggerLockToken = await acquireReplyLock(`comment:${page.id}`, platformCommentId);
                    if (!triggerLockToken) {
                        pipelineMetrics.record(pipeline, 'lock_contention');
                        this.logger.info(`[${platform}] Post Reply comment lock held — another worker handling`, { platformCommentId });
                        return { success: false, commentId: comment.id, error: 'Lock held by another worker' };
                    }
                    try {
                        // Any-comment mode fires on EVERY comment, so — unlike opt-in keyword
                        // mode — it must run the AI path's skip rules plus a no-AI complaint
                        // guard before sending, or it would template-reply to friend-tags,
                        // spam links, and complaints. Keyword mode keeps its original behavior.
                        if (rule.triggerType === 'all') {
                            const pre = preprocessCommentText({
                                text: commentMessage,
                                messageTags,
                                ourFacebookPageId: platform === 'facebook' ? platformPageId : undefined,
                                hasPostContext: !!content.message,
                            });
                            const verdict = evaluateAnyCommentGuard({
                                skipReason: pre.skipReason,
                                // Same probe as rewriteContentFreeCta: the cleaned text, or the
                                // raw comment when cleaning stripped it to empty.
                                isContentFree: isContentFree((pre.commentForAI || commentMessage).trim()),
                                fallbackIntent: classifyFallbackIntent(commentMessage),
                                businessActionFlags: detectBusinessActionFlags(commentMessage),
                            });
                            if (verdict.action === 'skip') {
                                await this.silentlyResolveAndSkip(comment, page.id, userId, workspaceId, 'spam', verdict.reason);
                                pipelineMetrics.record(pipeline, 'skipped_spam');
                                this.logger.info(`[${platform}] Any-comment Post Reply skipped`, {
                                    commentId: comment.id, platformCommentId, reason: verdict.reason,
                                });
                                return { success: true, commentId: comment.id };
                            }
                            if (verdict.action === 'flag') {
                                await adapter.flagComment(comment.id, verdict.flagReason, undefined);
                                notificationService.sendTemplateNotificationToWorkspace(
                                    workspaceId,
                                    'flagged_reply',
                                    { senderName: fromName || 'Unknown', reason: buildNotificationReason(verdict.flagReason, commentMessage) },
                                    {
                                        commentId: comment.id,
                                        type: 'comment',
                                        deepLink: '/comments?filter=flagged',
                                        ...(isUrgentNotification(verdict.flagReason) ? { urgent: true } : {}),
                                    },
                                ).catch(err => this.logger.error('Any-comment flag notification failed', { err }));
                                pipelineMetrics.record(pipeline, 'skipped_risky');
                                this.logger.info(`[${platform}] Any-comment Post Reply flagged for attention`, {
                                    commentId: comment.id, platformCommentId, flagReason: verdict.flagReason,
                                });
                                return { success: true, commentId: comment.id };
                            }
                            // Handoff pause — the merchant is manually talking to this customer
                            // (mirrors the AI path's isPaused gate). A canned template must not
                            // interject into a live human conversation; any-comment fires on
                            // every comment (sub-comments included) so this is reachable in a
                            // way keyword mode never was. Leave the comment pending — no send,
                            // no resolve — the merchant is already engaged with the thread.
                            if (fromId && await messagesService.isPaused(page.id, fromId, userSettings.handoffPauseDurationMinutes)) {
                                pipelineMetrics.record(pipeline, 'handoff_active');
                                this.logger.info(`[${platform}] Any-comment Post Reply suppressed — handoff pause active for sender`, {
                                    commentId: comment.id, platformCommentId, fromId,
                                });
                                return { success: true, commentId: comment.id };
                            }
                            // Per-post cap — an any-comment rule on a viral post would otherwise
                            // fire on hundreds of comments (public-reply spam / Meta flagging).
                            // Keyword mode is naturally bounded, so this only guards 'all'.
                            if (await postReplyCap.isOverCap(page.id, content.id)) {
                                await this.silentlyResolveAndSkip(comment, page.id, userId, workspaceId, 'spam', 'post_reply_cap_reached');
                                pipelineMetrics.record(pipeline, 'post_reply_capped');
                                this.logger.info(`[${platform}] Any-comment Post Reply capped for this post`, {
                                    commentId: comment.id, platformCommentId, pageId: page.id, postId: content.id,
                                });
                                return { success: true, commentId: comment.id };
                            }
                            // action 'send' → fall through to the shared send below.
                        }

                        const result = await this.sendAndFinalize({
                            adapter, platform, pipeline,
                            pageId: page.id, userId, workspaceId,
                            comment, replyText: rule.triggerReply, replyMethod: 'post_reply',
                            commentMessage, platformCommentId, platformPageId,
                            accessToken: page.accessToken, fromId, fromName,
                            instagramCredential: page.instagramCredential,
                            userSettings: userSettings as unknown as Record<string, unknown>,
                            replyMode: effectiveReplyMode,
                            businessProfile: page.businessProfile,
                            postMessage: content.message || undefined,
                            contentId: content.id,
                            triggerKeyword: match.keyword ?? undefined,
                            triggerType: rule.triggerType,
                            replyImageUrl: rule.triggerImageUrl,
                            likeComment: rule.likeComment,
                            tagCommenter: rule.tagCommenter,
                            replyCta: rule.cta,
                        });
                        // Keep the debounce slot only if the reply actually went out
                        // (skip/flag/pause/cap/failed-send exits leave replyCommitted
                        // false → the shared release below frees the slot).
                        replyCommitted = result.success;
                        // Count a successful any-comment send toward the per-post cap.
                        if (rule.triggerType === 'all' && result.success) {
                            await postReplyCap.increment(page.id, content.id);
                        }
                        return result;
                    } finally {
                        await releaseReplyLock(`comment:${page.id}`, platformCommentId, triggerLockToken).catch(() => { /* TTL will auto-expire */ });
                    }
                }
                // Keyword rule set but comment didn't match — fall through to AI so a real
                // question on the post still gets answered. (Any-comment always matches, so
                // this branch is keyword-only.)
                this.logger.info(`[${platform}] Post Reply rule set but comment did not match — falling through to AI`, {
                    platformCommentId, triggerType: rule.triggerType,
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

            // Early exit: settings disabled (after storing so the comment is persisted).
            // Resolve so the comment doesn't sit as Pending forever — auto-reply is off,
            // no pipeline will ever act on it. Merchant can still reply manually from the
            // inbox; resolving just keeps the "needs action" count honest.
            if (!isCommentsEnabled) {
                pipelineMetrics.record(pipeline, 'settings_disabled');
                await this.silentlyResolveAndSkip(comment, page.id, userId, workspaceId, 'spam', 'comments_auto_reply_disabled');
                return { success: false, commentId: comment.id, error: 'Comments auto-reply disabled' };
            }

            // Early exit: already replied or already flagged
            if (!isNew && (comment.replied || comment.needsAttention)) {
                pipelineMetrics.record(pipeline, 'already_replied');
                return { success: false, commentId: comment.id, error: 'Comment already replied' };
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
                    // Resolve — we intentionally won't reply to rate-limited spam, and we
                    // don't want the comment sitting as Pending in the merchant's view.
                    await this.silentlyResolveAndSkip(comment, page.id, userId, workspaceId, 'spam', 'rate_limited');
                    return { success: false, commentId: comment.id, error: 'Rate limited' };
                }
            } else {
                this.logger.debug(`[${platform}] Rate limit skipped — no fromId`, { platformCommentId });
            }

            // 7. Reply delay (jittered 0.5×–1.5× so replies don't land at a constant
            //    time — see computeHumanDelayMs and the ReplyDelayCard copy it matches)
            const replyDelay = userSettings.replyDelay;
            if (replyDelay > 0) {
                await this.delay(computeHumanDelayMs(replyDelay));
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
            generatorContext.businessInfoBlock = enriched.businessInfoBlock;
            generatorContext.factCollectionsBlock = enriched.factCollectionsBlock;
            generatorContext.factCollectionsGated = enriched.factCollectionsGated;
            generatorContext.replyStyle = userSettings.replyStyle;
            generatorContext.replyMode = effectiveReplyMode;
            generatorContext.defaultReplyLanguage = userSettings.defaultReplyLanguage;
            generatorContext.timezone = userSettings.timezone;
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
            // D-111: the content row, so the generator's content-free gate can read the
            // post's stored CTA classification (and write it, once, on the first symbol
            // comment). Comment adapters are Facebook/Instagram only by construction.
            if (platform === 'facebook' || platform === 'instagram') {
                generatorContext.contentRef = { contentId: content.id, platform };
            }

            const commentReplyMode = (userSettings.commentReplyMode as 'public' | 'private' | 'dual') || 'public';
            const generated =
                await replyGenerator.generateForComment(generatorContext, userSettings.aiEnabled ?? false, commentReplyMode);

            // 8a. D-111 gate skip — a content-free comment («.», «٠٠٠», «❤️») on a post
            // whose text did not invite it. No model ran, nothing was billed, nothing is
            // sent in any reply mode. Resolved silently under its OWN reason (not `spam`);
            // the pipeline counter and the per-post tally were recorded by the gate
            // observer at decision time. Must run before 8b/8c: the `solicitedCta`
            // backstop below deliberately revives SPAM verdicts on content-free comments,
            // and this is not one of those (the result carries no intent at all).
            if (generated.skipReason === UNINVITED_SYMBOL_SKIP) {
                await this.silentlyResolveAndSkip(comment, page.id, userId, workspaceId, UNINVITED_SYMBOL_SKIP);
                this.logger.info(`[${platform}] Uninvited symbol comment skipped (D-111)`, {
                    commentId: comment.id, platformCommentId, postId: content.id, commentMessage,
                });
                return { success: true, commentId: comment.id };
            }

            // Only generatedText is reassigned below (fallback/truncation); the rest are const.
            let generatedText = generated.replyText;
            const { replyMethod, needsAttention, flagReason, flagMeta, aiIntent, confidence } = generated;
            // Same rule as the DM path: a phone the commenter typed to prove an
            // order is theirs is an identity claim, not a lead's contact line.
            const identityVerificationTurn = isIdentityVerificationTurn(generated.toolOutcomes);

            // Capture the original AI-generated reply before any modifications (fallback, truncation, CTA)
            const aiOriginalReply = replyMethod === 'ai' ? (generatedText ?? undefined) : undefined;

            // 8b. Replace with safe fallback if AI hallucinated a price
            if (shouldUseFallback(flagReason, aiIntent)) {
                const lang = resolveFallbackLanguage({
                    text: commentMessage,
                    postMessage: content.message || undefined,
                    knowledgeBase: generatorContext.knowledgeBase,
                    defaultReplyLanguage: userSettings.defaultReplyLanguage,
                });
                generatedText = PRICE_FALLBACK[lang];
            }

            // 8c. Skip reply — silent for spam/tags, flagged for offensive content.
            // Exception: never SPAM-skip a content-free comment on a post — "٠٠٠" / "."
            // is the customer following the post's CTA (in any reply mode). The
            // rewriteContentFreeCta input fix normally prevents the spam verdict; this
            // is the deterministic backstop so a model quirk can't silently drop a
            // solicited lead (eval #324, لامار الشام regression). OFFENSIVE is NOT
            // bypassed — shouldSilentlySkip is true only for SPAM_OR_IRRELEVANT.
            // Since D-111 a content-free comment reaching this line is one the gate
            // let through: invited (enforce mode) or shadow-mode traffic. Uninvited
            // symbols never get here — they returned at 8a.
            const solicitedCta = !!content.message && isContentFree(commentMessage.trim());
            if (shouldSkipReply(flagReason, aiIntent) && !(solicitedCta && shouldSilentlySkip(aiIntent))) {
                if (shouldSilentlySkip(aiIntent)) {
                    // Spam/irrelevant (tagging someone, emoji-only, etc.) — no flag, no
                    // notification. `friend_tag` skips are handled upstream in step 3a, so
                    // anything reaching here is AI-classified spam — reason is always `spam`.
                    await this.silentlyResolveAndSkip(comment, page.id, userId, workspaceId, 'spam', flagReason);
                    pipelineMetrics.record(pipeline, 'skipped_spam');
                    this.logger.info(`[${platform}] Comment silently skipped as spam/irrelevant`, {
                        commentId: comment.id, platformCommentId, aiIntent, commentMessage,
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
                    { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged', urgent: true },
                ).catch(err => this.logger.error('Offensive comment notification failed', { err }));
                pipelineMetrics.record(pipeline, 'skipped_risky');
                return { success: true, commentId: comment.id };
            }

            // 8c-bis. Withhold exhausted self-identification strips (always on, no
            // setting) — same rationale, ordering and row shape as the DM pipeline
            // (12c-bis): Check 6 removed the ENTIRE reply (all reveal talk) and the
            // validator no longer substitutes a canned identity line.
            //
            // Must run BEFORE 8d (a low-confidence exhausted reply would be stored
            // as `held_low_confidence` with an empty draft) and BEFORE step 9 (its
            // adapter fallback would swap in canned text — the exact failure mode
            // this exists to remove). `flagComment`, not `markAsReplied('')`: the
            // public comment is genuinely unanswered, and the pre-strip text is the
            // automation reveal itself, so it must not become a merchant draft.
            if (shouldHoldReply(flagReason)) {
                await adapter.flagComment(comment.id, 'held_self_identification', aiIntent);
                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'flagged_reply',
                    { senderName: fromName || 'Unknown', reason: 'held_self_identification' },
                    { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' },
                ).catch(err => this.logger.error('Held reply notification failed', { err }));
                // Withholding OUR reply must not discard THEIR lead — the shared
                // capture lives in sendAndFinalize, downstream of this return.
                leadExtractorService.maybeCaptureLead({
                    pageId: page.id,
                    userId,
                    workspaceId,
                    sourceId: comment.id,
                    sourceType: 'comment',
                    senderId: fromId ?? '',
                    senderName: fromName,
                    replyMode: effectiveReplyMode,
                    messageText: commentMessage,
                    postMessage: content.message || undefined,
                    identityVerificationTurn,
                }).catch(() => { /* errors captured inside maybeCaptureLead */ });
                pipelineMetrics.record(pipeline, 'held_self_identification');
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
                // Same rule as 8c-bis above: withholding OUR reply must not discard
                // THEIR lead. The shared capture lives in sendAndFinalize, downstream
                // of this return, so a commenter who volunteers a phone here would
                // otherwise be lost outright.
                leadExtractorService.maybeCaptureLead({
                    pageId: page.id,
                    userId,
                    workspaceId,
                    sourceId: comment.id,
                    sourceType: 'comment',
                    senderId: fromId ?? '',
                    senderName: fromName,
                    replyMode: effectiveReplyMode,
                    messageText: commentMessage,
                    postMessage: content.message || undefined,
                    identityVerificationTurn,
                }).catch(() => { /* errors captured inside maybeCaptureLead */ });
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
                    // No reply text, no adapter fallback — flag for merchant review so
                    // the comment surfaces in "Needs Attention" instead of sitting as
                    // Pending forever. Merchant still gets the notification so they can
                    // reply manually from the inbox.
                    await adapter.flagComment(comment.id, 'no_reply_generated', aiIntent)
                        .catch(err => this.logger.error('[CommentProcessor] flagComment after no-reply threw', { err, commentId: comment.id }));
                    notificationService.sendTemplateNotificationToWorkspace(
                        workspaceId,
                        'new_comment',
                        { senderName: fromName || 'Unknown' },
                        {
                            commentId: comment.id,
                            type: 'comment',
                            deepLink: '/comments?filter=flagged',
                            ...(isUrgentNotification(flagReason, aiIntent) ? { urgent: true } : {}),
                        },
                    ).catch(err => this.logger.error('New comment notification failed', { err }));
                    pipelineMetrics.record(pipeline, 'no_reply_generated');
                    return { success: false, commentId: comment.id, error: 'No reply generated' };
                }
            }

            // 9a. Render the canonical reply for this channel (see MessagePlatformAdapter.renderReply).
            replyText = adapter.renderReply(replyText);

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
                const notifyReason = buildNotificationReason(flagReason, commentMessage);
                const urgent = isUrgentNotification(flagReason, aiIntent);
                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'flagged_reply',
                    { senderName: fromName || 'Unknown', reason: notifyReason },
                    {
                        commentId: comment.id,
                        type: 'comment',
                        deepLink: '/comments?filter=flagged',
                        ...(urgent ? { urgent: true } : {}),
                    },
                ).catch(err => this.logger.error('Flagged notification failed', { err }));
            }

            // Workspace-level "like customers' comments" (the Smart Reply counterpart
            // of the per-post Post Reply toggle). AI replies ONLY: the generator's
            // template/fallback branches (AI quota exhausted → limitFallback, aiEnabled
            // off) classify no intent and set needsAttention=false, so without the
            // replyMethod gate every suppression clause below passes vacuously and the
            // page would like complaints while sending a canned message. A canned
            // fallback is also not a Smart Reply, which is what the toggle's copy
            // promises the like for. Of the two suppression clauses, !needsAttention is
            // the primary complaint defense (computeNeedsAttention forces it true for
            // COMPLAINT/OFFENSIVE); the intent set is its backstop — see its doc.
            const likeComment = (userSettings.likeComments ?? false)
                && replyMethod === 'ai'
                && !needsAttention
                && !NO_AUTO_LIKE_INTENTS.has(aiIntent ?? '');

            const finalizeResult = await this.sendAndFinalize({
                adapter, platform, pipeline,
                pageId: page.id, userId, workspaceId,
                comment, replyText, replyMethod, commentMessage,
                platformCommentId, platformPageId,
                accessToken: page.accessToken, fromId, fromName,
                instagramCredential: page.instagramCredential,
                likeComment,
                userSettings: userSettings as unknown as Record<string, unknown>,
                replyMode: effectiveReplyMode,
                businessProfile: page.businessProfile,
                postMessage: content.message || undefined,
                contentId: content.id,
                needsAttention, flagReason, flagMeta, aiIntent, aiOriginalReply,
                confidence, identityVerificationTurn,
                groundingSource: buildGroundingSource({
                    knowledgeBase: generatorContext.knowledgeBase,
                    postMessage: content.message,
                    storePolicies: generatorContext.storePolicies,
                    productCatalog: generatorContext.productCatalog,
                    factCollectionsBlock: generatorContext.factCollectionsBlock,
                    businessInfoBlock: generatorContext.businessInfoBlock,
                }),
                groundingPersona: generatorContext.brandVoiceNotes,
            });
            // Keep the debounce slot only if the reply actually went out.
            replyCommitted = finalizeResult.success;
            return finalizeResult;

            } finally {
                await releaseReplyLock(`comment:${page.id}`, platformCommentId, lockToken).catch(() => { /* TTL will auto-expire */ });
            }

        } catch (error) {
            // Refusal / empty-after-filter are deterministic — retry will produce the
            // same failure. Flag the comment needs_attention immediately with the
            // specific reason and notify the merchant so they can fix the underlying
            // KB / brand-voice / policy issue. No rethrow → no BullMQ retry.
            if (needsImmediateAttention(error)) {
                const isRefusal = error instanceof AiRefusalError;
                const flagReason = isRefusal ? 'ai_refused' : 'ai_empty_reply';
                // Prefer the worker's specific message (e.g. truncated-after-retry)
                // over the generic one — it reaches flag_meta and makes the failure
                // diagnosable without replaying the pipeline.
                const flagMeta = isRefusal
                    ? { ai_refused: { reason: error.refusalReason } }
                    : {
                        ai_empty_reply: {
                            reason: error instanceof Error && error.message
                                ? error.message
                                : 'AI reply was empty after content filtering',
                        },
                    };

                try {
                    // Scope: facebook_comment only. Instagram comments live in a
                    // separate table — same gap as flagStuckJobOnFinalFailure
                    // (replyWorker.ts:343). Documented follow-up.
                    const existing = await commentsService.getCommentByFacebookId(platformCommentId);
                    if (existing && !existing.replied && !existing.needsAttention) {
                        await commentsService.updateComment(existing.id, {
                            needsAttention: true,
                            flagReason,
                            flagMeta,
                        });
                        // workspaceId pulled from the comment row (denormalized from pages.workspace_id)
                        // since the try-block scope's workspaceId isn't reachable from this catch.
                        notificationService.sendTemplateNotificationToWorkspace(
                            existing.workspaceId,
                            'flagged_reply',
                            { senderName: fromName || existing.fromName || 'Unknown', reason: flagReason },
                            { commentId: existing.id, type: 'comment', deepLink: '/comments?filter=flagged' },
                        ).catch(err => this.logger.error('[CommentProcessor] AI-failed notification failed', { err }));
                    }
                } catch (flagErr) {
                    this.logger.error('[CommentProcessor] Failed to flag for ai_refused/empty', {
                        flagErr: flagErr instanceof Error ? flagErr.message : String(flagErr),
                        platformCommentId,
                    });
                }

                pipelineMetrics.record(pipeline, 'ai_failed_immediate_flag');
                this.logger.warn(`[${platform}] AI ${flagReason} — flagged immediately, no retry`, {
                    platformCommentId,
                    error: error instanceof Error ? error.message : String(error),
                });
                return {
                    success: false,
                    commentId: platformCommentId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }

            // Transient DM errors (FB rate limit, 5xx, -1/2018012 "Unexpected internal error",
            // network blips) MUST bubble up so BullMQ retries the whole job — sender.ts
            // throws these specifically to trigger retry. Swallowing them here marks the
            // job "completed with failure" and BullMQ never retries, leaving the comment
            // stuck as replied=false / needs_attention=false / flag_reason=null — invisible
            // to the merchant and never re-attempted. Confirmed prod failure: Mohamad Shami
            // "عنوان" 2026-05-14, DM hit FB -1/2018012, comment abandoned silently.
            //
            // Same rationale for transient AI errors (ai-worker unreachable during deploy,
            // 5xx, circuit-open, tool-loop exhausted): rethrow so BullMQ retries — never
            // let the catch substitute a templated "شكراً لتعليقك!" reply mid-conversation.
            if (isTransientFbError(error, platform) || isTransientAiError(error)) {
                pipelineMetrics.record(pipeline, 'transient_error_retry');
                this.logger.warn(`[${platform}] Transient error — rethrowing for BullMQ retry`, {
                    platformCommentId,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
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
        } finally {
            // Release the debounce slot if we claimed it but did NOT send a reply
            // — skips (spam/rate-limit/held), no-reply, send failure, and the
            // transient-error rethrow that triggers a BullMQ retry. Without this,
            // a retried comment would hit its own held key and be silently
            // debounced, dropping the reply. A committed successful send keeps the
            // slot for the window so genuine back-to-back duplicates stay suppressed.
            if (releaseDebounceSlot && !replyCommitted) {
                await releaseDebounceSlot().catch(() => { /* fail-open; TTL expires the slot */ });
            }
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
        replyMethod: 'template' | 'ai' | 'post_reply';
        commentMessage: string;
        platformCommentId: string;
        platformPageId: string;
        accessToken: string;
        /** Instagram host + credential for this page — see `resolveInstagramCredential`. */
        instagramCredential?: import('../instagramCredential').InstagramCredential;
        fromId?: string;
        fromName?: string;
        userSettings: Record<string, unknown>;
        /** Effective reply mode of the page — forwarded to lead capture so info
         *  pages store leads silently (push suppressed). */
        replyMode?: string;
        /** The page's raw business profile, for the post-send reply-mode counter
         *  ONLY. Passed rather than derived by the caller so the unwrap happens
         *  after the reply is out, never before it (Rule 17). */
        businessProfile?: unknown;
        postMessage?: string;
        /** Business Info exactly as the generator saw it, for the post-send
         *  grounding audit. Absent on the post_reply path (merchant-authored
         *  text — nothing to verify), which the gate rejects anyway. */
        groundingSource?: string;
        /** Merchant persona — a separate field from groundingSource so it can
         *  ground a claim without counting toward MIN_KB_CHARS. */
        groundingPersona?: string;
        /** The originating post/media UUID. Persisted on the conversation so
         *  follow-up DMs can inherit post context (see messageProcessor). */
        contentId: string;
        /** This reply's tool round consumed the commenter's phone as an identity
         *  claim (see isIdentityVerificationTurn) — forwarded to lead capture so
         *  an order-tracking commenter is not filed as a prospect. Absent on the
         *  post_reply path, which runs no tools. */
        identityVerificationTurn?: boolean;
        needsAttention?: boolean;
        flagReason?: string;
        flagMeta?: import('@jawab24/shared').FlagMeta | null;
        aiIntent?: string;
        aiOriginalReply?: string;
        confidence?: string;
        triggerKeyword?: string;
        /** Post Reply analytics — how the rule fired ('keyword' | 'all'). Only set on the post_reply path. */
        triggerType?: 'keyword' | 'all';
        /** Post Reply image URL — delivered only on the DM channel (adapter gates by mode).
         *  Only ever set on the post_reply path. */
        replyImageUrl?: string | null;
        /** Like the customer's comment after a successful send. Set by the post_reply
         *  path (per-post `posts.like_comment` toggle) and the smart-reply path (the
         *  workspace `likeComments` setting, complaint-guarded at the call site).
         *  Effective only on adapters that implement likeComment (Facebook — the
         *  Instagram API can't like). */
        likeComment?: boolean;
        /** Post Reply option: mention (@-tag) the commenter in the public comment we post.
         *  Only ever set on the post_reply path; Facebook only (the sender resolves it against
         *  `fromId`, and Instagram's adapter ignores it — IG mentions use `@username`). */
        tagCommenter?: boolean;
        /** Post Reply CTA link button (DM channel only). Only ever set on the post_reply path. */
        replyCta?: { label: string; url: string } | null;
    }): Promise<CommentResult> {
        const {
            adapter, platform, pipeline, pageId, userId, workspaceId,
            comment, replyText, replyMethod, commentMessage,
            platformCommentId, platformPageId, fromId, fromName, userSettings,
            contentId, needsAttention, flagReason, flagMeta, aiIntent, aiOriginalReply,
            confidence, triggerKeyword, triggerType, replyMode, businessProfile,
        } = opts;

        // A revoked page credential is re-mintable in ONE Graph call, so the
        // customer in front of us must not pay for it: re-mint and retry once
        // before this counts as a lost reply. Recovering only in the
        // fire-and-forget `recordSendFailure` below helps comment N+1 — the
        // comment that EXPOSED the dead token still goes unanswered, which is the
        // 2026-08-14 outage in miniature and on the very surface it was reported.
        //
        // `accessToken` is rebound from the result, not read from `opts`, because
        // a fresh token has to be ADOPTED for the rest of this method: the
        // `likeComment` call below runs on the same credential and would
        // otherwise use the one we just proved dead.
        //
        // Comment pipelines are Facebook/Instagram-only by construction (there is
        // no WhatsApp comment adapter), so the `ownsFacebookCredential` gate the
        // DM path needs has nothing to exclude here. An Instagram LOGIN page does
        // reach this line, and is handled one layer down: `recoverPageToken`
        // requires a `facebook_page_id`, which such a row never has, so the
        // wrapper resolves to "no fresh token" and the send result stands. The
        // credential it holds is kept alive by `instagramLoginService`'s own
        // refresh sweep instead.
        const { result: sendResult, accessToken } = await withPageTokenRetryResult(
            pageId,
            opts.accessToken,
            (token) => adapter.sendReply({
                platformCommentId,
                platformPageId,
                replyText,
                commentMessage,
                accessToken: token,
                instagramCredential: opts.instagramCredential,
                fromId,
                userSettings,
                postMessage: opts.postMessage,
                replyImageUrl: opts.replyImageUrl,
                postId: contentId,
                replyCta: opts.replyCta,
                tagCommenter: opts.tagCommenter,
            }),
            // The whole failure object, not its bucket: it carries the Graph
            // code/subcode that tells a dead credential from a page Facebook is
            // simply rejecting.
            //
            // ⚠️ `publicFailure` is not optional garnish — it is the DEFAULT mode.
            // `commentReplyMode` defaults to 'public' (schema.ts, workspaceSettings,
            // and the adapter's own `|| 'public'`), and a public post produces no
            // `dmFailure` because no DM is attempted. Reading `dmFailure` alone made
            // this whole retry inert for every pre-existing workspace — the fix
            // present, tested, and doing nothing on the path it was written for.
            (r) => (r.success ? undefined : (r.dmFailure ?? r.publicFailure)),
        );

        if (!sendResult.success) {
            pipelineMetrics.record(pipeline, 'send_failed');
            // Defensive auto-pause: bump page-level failure counter (fire-and-forget).
            // Only `our_fault` / `unknown` / no-bucket count — `customer_refused` and
            // `window_expired` are per-customer issues, not page-wide. See pageAutoPause.ts.
            // The whole dmFailure (not just its bucket): it carries the Graph
            // code/subcode, which is what tells a revoked credential — re-mintable
            // in one call — apart from a page Facebook simply keeps rejecting.
            // The BUCKET stays `dmFailure`-only on purpose: a public post has never
            // carried one, so it counts as `no_bucket` (page-level) exactly as before.
            // Widening it here would quietly change which failures reach the auto-pause
            // threshold. Only the 4th argument — the recovery signal — gains the public
            // failure, so a revoked credential is re-minted on the default path too.
            void recordSendFailure(
                pageId,
                sendResult.dmFailure?.bucket,
                undefined,
                sendResult.dmFailure ?? sendResult.publicFailure,
            );
            // Flag the comment so it surfaces in "Needs Attention" — previously it stayed
            // replied=false/needsAttention=false/resolved=false, i.e. Pending forever.
            // Swallow a secondary DB error here: we already failed to send, the SSE event
            // below still fires, and the outer catch would otherwise mask sendResult.error.
            // flagReason must be a translatable snake_case key, not the raw error string —
            // the UI looks it up in the flagReason i18n namespace. Structured detail
            // (FB error code, bucket) lives in flag_meta for debugging + localization.
            const dmf = sendResult.dmFailure;
            const flagKey = dmf ? 'dm_failed' : 'send_failed';
            const flagMeta = dmf ? buildDmFailedFlagMeta(dmf) : null;
            // customer_refused = the customer's account blocks page DMs (FB error 10903 etc).
            // No manual intervention can succeed (the page owner would hit the same restriction),
            // so auto-resolve instead of flagging — keeps the inbox actionable. Detail still
            // lands in flag_meta for analytics / "unreachable" filtering.
            const autoResolve = dmf?.bucket === 'customer_refused';
            await adapter.flagComment(comment.id, flagKey, undefined, flagMeta, autoResolve)
                .catch(err => this.logger.error('[CommentProcessor] flagComment after send-failed threw', { err, commentId: comment.id }));
            publishSSEEvent(userId, 'comment:reply_failed', {
                commentId: comment.id,
                pageId,
                error: sendResult.error || 'Failed to send reply',
            });
            return { success: false, commentId: comment.id, error: sendResult.error };
        }

        // A Post Reply with an image sends it as its own native-image message alongside the
        // text. Record a quiet "image attached" marker on the OUTGOING rows so both threads
        // show a badge — the merchant otherwise can't tell the reply carried an image. Never
        // an alarm. Driven by `imageDelivered` (the image send actually SUCCEEDED), not merely
        // "an image was attached" — an image whose send failed leaves the text delivered but
        // no badge, keeping the badge honest.
        //
        // Two DISTINCT targets, deliberately not the same object:
        //   • the stored DM row (message thread) gets ONLY the delivery markers
        //     (reply_image / reply_cta). It previously carried no flagMeta at all; the
        //     comment's needs-attention flags (info_not_in_kb, dm_failed, …) are
        //     comment-scoped and must NOT leak onto the outgoing bubble (they'd show a
        //     KB-gap badge / match flagMeta filters there).
        //   • the comment row merges the delivery markers INTO its own flagMeta
        //     (additive), since that row legitimately holds the reply's needs-attention flags.
        const hasReplyImage = sendResult.imageDelivered === true;
        // Post Reply CTA button: the Facebook sender attaches the CTA to every DM shape
        // that can succeed (button template, image card, image-fallback text), so
        // "a DM went out AND a CTA was configured" is exactly "the customer received the
        // button". Stored with its label + URL — not a bare marker — so the thread views
        // can render the button the customer actually sees; without this the app had no
        // record a button was ever sent. (Instagram's adapter takes no CTA and returns no
        // dmRecipientId, so the condition stays false there.)
        const deliveredCta = opts.replyCta && sendResult.dmRecipientId
            ? { label: opts.replyCta.label, url: opts.replyCta.url }
            : undefined;
        const deliveryMarkers = {
            ...(hasReplyImage ? { reply_image: {} as Record<string, never> } : {}),
            ...(deliveredCta ? { reply_cta: deliveredCta } : {}),
        };
        const hasDeliveryMarkers = hasReplyImage || !!deliveredCta;
        const messageFlagMeta = hasDeliveryMarkers ? deliveryMarkers : undefined;
        const commentFlagMeta = hasDeliveryMarkers
            ? { ...(flagMeta ?? {}), ...deliveryMarkers }
            : flagMeta;

        // Store outgoing DM so conversation history exists for future messages from this sender.
        // Pass fromName — the commenter's display name from the webhook — so the conversation's
        // senderName is filled in even when the customer only commented (never DM'd us first).
        // Without this, comment-triggered DMs surfaced as "Unknown User" in the inbox.
        if (sendResult.dmRecipientId) {
            messagesService.storeOutgoingMessage(
                pageId, workspaceId, sendResult.dmRecipientId, replyText,
                replyMethod as 'template' | 'ai' | 'manual' | 'post_reply',
                undefined, fromName, contentId, undefined, messageFlagMeta,
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
            commentFlagMeta,
        );

        publishSSEEvent(userId, 'comment:reply_sent', {
            commentId: comment.id,
            pageId,
            replyMethod: replyMethod as 'template' | 'ai' | 'post_reply',
            replyText,
            senderName: fromName ?? null,
        });

        // Activation funnel: this page just sent an automated reply. Idempotent —
        // only the first send per user is recorded (unique user_id+event index).
        void recordActivationEvent(userId, 'first_autoreply_sent', { pageId, channel: 'comment', replyMethod });

        // Defensive auto-pause: any successful send resets the failure streak.
        // Cheap (UPDATE guarded by counter > 0 inside the helper).
        void recordSendSuccess(pageId);

        // Post Reply "like the comment" option (ManyChat parity): the page likes the
        // customer's comment once the reply is out. Best-effort fire-and-forget — the
        // adapter method self-logs and never throws (see facebookService.likeComment),
        // so the call is unawaited with only an unhandled-rejection guard. Demo pages
        // carry a fake token, so they never hit the Graph API. Failures are counted
        // (`like_failed`) so a systemic break (revoked permission, API change) shows
        // up in pipeline metrics instead of only in grep-able logs.
        if (opts.likeComment && adapter.likeComment && !isDemoPlatformId(platformPageId)) {
            void adapter.likeComment(platformCommentId, accessToken)
                .then(liked => { if (!liked) void pipelineMetrics.record(pipeline, 'like_failed'); })
                .catch(() => { /* self-logged */ });
        }

        // NB: the per-(page, post, sender) debounce slot is claimed atomically at
        // the start of processComment (step 3ab), not armed here. A successful send
        // leaves the slot in place (processComment keeps it when replyCommitted is
        // true); non-send outcomes release it in the outer finally.

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
            replyMode: opts.replyMode,
            messageText: commentMessage,
            postMessage: opts.postMessage,
            replyText,
            identityVerificationTurn: opts.identityVerificationTurn,
        }).catch(() => { /* errors captured inside maybeCaptureLead */ });

        // Fire-and-forget grounding verification (SYSTEM_ANALYSIS gap 13).
        // Detection only: it flags the stored row, never the sent reply. Gated
        // internally (shouldVerifyGrounding) and off unless
        // GROUNDING_VERIFY_ENABLED=true, so this is inert until switched on.
        groundingVerifierService.maybeVerifyGrounding({
            userId,
            pageId,
            sourceId: comment.id,
            sourceType: 'comment',
            kb: opts.groundingSource ?? '',
            persona: opts.groundingPersona,
            question: commentMessage,
            reply: replyText ?? '',
            intent: aiIntent,
            replyMethod,
        }).catch(() => { /* errors captured inside maybeVerifyGrounding */ });

        pipelineMetrics.record(pipeline, 'success');

        this.logger.info(`[${platform}] reply_sent`, {
            event: 'reply_sent',
            pipeline,
            platform,
            pageId,
            commentId: comment.id,
            replyMethod,
            ...(replyMethod === 'post_reply'
                ? { triggerType: triggerType ?? 'keyword', ...(triggerKeyword ? { triggerKeyword } : {}) }
                : { aiIntent, confidence, flagReason: flagReason || null, needsAttention }),
            replyLength: replyText.length,
            replyMode: replyMode ?? null,
        });

        // The comment half of the same counter. Emitting it from the DM
        // processor only would have measured at most 53% of info-mode replies
        // (469 DM vs 86 comment over the pilot), and D-087's owed weekly reading
        // covers BOTH surfaces — a comment surface with no baseline is exactly
        // the gap the pilot could not close.
        void pipelineMetrics.recordReplyMode(toReplyMode(replyMode), (() => {
            const { merchant, merchantProvenance } = unwrapBusinessProfile(
                businessProfile as Parameters<typeof unwrapBusinessProfile>[0],
            );
            return hasRoutableContactChannel(merchant ?? {}, merchantProvenance);
        })());

        return { success: true, commentId: comment.id, replyText, replyMethod };
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const commentProcessor = new CommentProcessor();
