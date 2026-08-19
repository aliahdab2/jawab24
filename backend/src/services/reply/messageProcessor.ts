import { workspaceSettingsService } from '../workspaceSettings';
import { messagesService } from '../messages';
import { conversationsService } from '../conversations';
import { rateLimiter } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator, shouldSkipReply, shouldSilentlySkip, shouldUseFallback, shouldHoldReply, PRICE_FALLBACK, resolveFallbackLanguage } from './generator';
import { isOpenerMessage } from './openerPatterns';
import { detectTemplateLanguage } from '../../utils/language';
import { WORST_CASE_ENRICHMENT_MS, WORST_CASE_ENRICHMENT_WHATSAPP_MS } from '../imageUnderstanding';
import { pipelineMetrics, Pipeline } from '../../lib/pipelineMetrics';
import { acquireReplyLock, releaseReplyLock } from '../../lib/replyLock';
import { redis } from '../../lib/redis';
import * as typingIndicator from './typingIndicator';
import { computeHumanDelayMs } from './humanDelay';
import { Logger, noopLogger } from '../../types';
import { db } from '../../db';
import { posts, instagramMedia, messages } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { MessagePlatformAdapter, MessageResult } from '../../interfaces';
import { enrichPageContext } from './contextEnricher';
import { composeFactMatchText } from '../factCollectionsMatcher';
import { publishSSEEvent } from '../../lib/eventBus';
import { invalidateWorkspaceStatsCache } from '../pages';
import { subscriptionsService } from '../subscriptions';
import { facebookService } from '../facebook';
import { instagramService } from '../instagram';
import { instagramCredentialOf } from '../instagramCredential';
import type { SSEMessageSnapshot } from '@jawab24/shared';
import { resolveEffectiveReplyMode } from '@jawab24/shared';
import { isUrgentNotification, buildNotificationReason } from './urgentFlags';
import { truncateAtSentence } from '../../utils/text';
import { isPunctuationOnly } from '../../utils/commentText';
import {
    isTransientFbError,
    isTransientAiError,
    needsImmediateAttention,
    AiRefusalError,
    classifyDmError,
    buildDmFailedFlagMeta,
} from '../../utils/fbGraphErrors';
import { leadExtractorService } from '../leadExtractor';
import { groundingVerifierService, buildGroundingSource, shouldVerifyGrounding } from '../groundingVerifier';
import { recordActivationEvent } from '../activation';
import { recordSendFailure, recordSendSuccess, ownsFacebookCredential } from '../pageAutoPause';
import { withPageTokenRetry } from '../pageTokenRecovery';
import { extractPostId } from '../../utils/instagram';

/** Max age of the origin post to inherit into a follow-up DM's AI context.
 *  Older posts often contain relative-time claims ("tomorrow we start X") that
 *  would mislead the AI. Above this threshold we degrade to context-free —
 *  better no context than stale context. Pre-existing comments on old posts
 *  have the same issue and are out of scope for this pass. */
const MAX_ORIGIN_POST_AGE_MS = 60 * 24 * 60 * 60 * 1000;

/** One away-message acknowledgment per sender per 24h. Matches Meta's 24h
 *  messaging window: within one window the customer needs telling once that
 *  nobody is home, and the merchant can still reply to that same conversation. */
const AWAY_MESSAGE_COOLDOWN_SECONDS = 24 * 60 * 60;

/** Cap for the origin POST text inside the composed [current_post] context. The merchant's
 *  Post Reply is appended AFTER the post text (uncapped — product-limited to 1000 chars), so
 *  capping only the post text guarantees the reply's tail (price/details) always survives the
 *  prompt builder's overall block cap. Mirrors the previous prompt-side 500-char cap. */
const ORIGIN_POST_TEXT_CAP = 500;

/** Store-then-enrich park (step 11): a sibling attachment from the same sender is
 *  stored as a 'pending' stub the instant its webhook lands, then enriched
 *  asynchronously (vision / Whisper / shared-post fetch). A DM whose reply
 *  job reaches consolidation while such a stub is still 'pending' PARKS — it
 *  re-enqueues itself so the eventual reply consolidates the real content instead
 *  of answering the bare "[صورة]" placeholder (or the text alone, blind). */
const ATTACHMENT_PARK_DELAY_MS = 5_000;
/** Retries needed to outlast the worst-case enrichment, plus one delay of slack
 *  for store/enqueue. DERIVED, never hand-typed: this budget was a literal 8
 *  ("40s ≥ the ~35s worst case") until the vision deadline moved to 35s and
 *  quietly made the worst case ~65s, at which point a parked job would answer
 *  blind while the enrichment it waited for was still running. After the budget
 *  the job proceeds and replies without the pending row — degrading to today's
 *  "second reply", never a permanent no-reply. */
const worstCaseEnrichmentMs = (platform: string): number =>
    platform === 'whatsapp' ? WORST_CASE_ENRICHMENT_WHATSAPP_MS : WORST_CASE_ENRICHMENT_MS;
const maxAttachmentRetries = (platform: string): number =>
    Math.ceil(worstCaseEnrichmentMs(platform) / ATTACHMENT_PARK_DELAY_MS) + 1;
/** A 'pending' stub older than this is treated as NOT pending: the enricher must
 *  have crashed (webhook already ACKed, no redelivery), so no DM should wait on a
 *  corpse. Must stay ABOVE the worst case or a still-running enrichment gets
 *  mistaken for a corpse — hence derived, with a 50% margin. The stale stub stays
 *  replied=false and is surfaced by the escalation SLA cron. */
const pendingEnrichmentMaxAgeMs = (platform: string): number =>
    Math.round(worstCaseEnrichmentMs(platform) * 1.5);

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
        // True iff this job was re-enqueued from a handoff pause (worker sets it
        // when `handoffRetries > 0`). Used to scope the "stale backlog" check —
        // we only want to suppress messages whose lateness was *caused* by our
        // pause logic, not messages delayed by queue lag or restarts.
        wasHandoffPaused: boolean = false,
        // How many times this job has already parked waiting for a sibling
        // attachment to finish enriching (store-then-enrich). Bounds the wait at
        // maxAttachmentRetries(platform) so we never block a reply forever.
        attachmentRetries: number = 0,
        // Sender display name captured by the webhook itself (WhatsApp
        // `contacts[].profile.name`). WhatsApp has no profile API, so the
        // webhook is the ONLY name source for that channel — when present it
        // wins over the adapter lookup. FB/IG webhooks don't carry names, so
        // it stays undefined there and the Graph API fetch runs as before.
        webhookSenderName?: string,
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

            // 2. Resolve sender name (best-effort) — do this BEFORE auto-reply check
            // so dashboard always shows real names, even when page is OFF.
            // Webhook-supplied name wins (WhatsApp's only source); adapter fetch
            // is the fallback (FB/IG Graph API lookup).
            let senderName: string | undefined = webhookSenderName;
            if (!senderName) {
                try {
                    senderName = await adapter.fetchSenderName(senderId, page.accessToken, page.id, platformPageId, page.instagramCredential?.baseUrl);
                } catch {
                    // Non-critical — continue without sender name
                }
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

            // SSE: notify merchant that a new message arrived.
            // Skip when this row carries an enrichment lifecycle (attachment rows):
            // nonTextHandler already published `message:received` for it at stub-store
            // time. Re-publishing here on the enriched attachment's own reply job
            // would double-toast and double-increment the unread badge. NULL status
            // = every text row (today's behavior, unchanged).
            if (!storedMessage.enrichmentStatus) {
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
            }

            // Invalidate dashboard stats so next load reflects the new message
            invalidateWorkspaceStatsCache(page.workspaceId);

            // 3.5. Enrich with shared post context (if customer attached a post to their message)
            if (sharedPostUrl || sharedPostId) {
                try {
                    const resolvedId = extractPostId(sharedPostUrl, sharedPostId);
                    if (resolvedId) {
                        const postContent = platform === 'instagram'
                            ? await instagramService.getPostContent(resolvedId, instagramCredentialOf(page))
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
            //
            //     Re-enqueue on contention rather than dropping. The lock is scoped
            //     per (pageId, senderId), so contention here means DIFFERENT messages
            //     from the same sender — typically the second of a rapid pair, OR
            //     simultaneous retries after a shared handoff-pause expiry. If the
            //     lock-holder skips its own message at step 5 ("newer pending")
            //     expecting THIS one to consolidate, dropping THIS one strands the
            //     conversation with no reply at all. A brief delay lets the holder
            //     finish; the retry then runs as the consolidating worker.
            //     Bounded by MAX_HANDOFF_RETRIES in replyWorker.
            const lockToken = await acquireReplyLock(page.id, senderId);
            if (!lockToken) {
                pipelineMetrics.record(pipeline, 'lock_contention');
                this.logger.info(`[${platform}] Lock held — re-enqueuing for retry`, { senderId, pageId: page.id });
                return {
                    success: false,
                    messageId: platformMessageId,
                    error: 'Lock held by another worker',
                    handoffDelayMs: 2000,
                };
            }
            lap('4b-acquireLock');

            // Track the platformMessageIds we handled at step 11 — used by the
            // post-release orphan recheck (finally block) to exclude them and
            // prevent re-processing of flagged/skipped messages that legitimately
            // stay replied=false. Recheck only fires when step 11 was reached
            // (early-return paths have no AI-generation race window).
            const handledPlatformMessageIds = new Set<string>();
            let didReachConsolidation = false;
            // The step-11b typing call, kept but NEVER awaited on the reply path.
            //
            // Delivery state lives in Redis (typingIndicator.wasShown) because on Messenger
            // the indicator is claimed by the WEBHOOK process, so no in-process flag could
            // know about it. This reference exists only so an ABORT path can let a
            // still-in-flight call settle before reading that state — otherwise a reply that
            // fails within the Meta round-trip would leave the indicator spinning. Null on
            // early-return paths, which also spares them the Redis read.
            let typingCall: Promise<boolean> | null = null;
            let replySent = false;
            /** Platform's own id for the sent reply (WhatsApp wamid); undefined on FB/IG. */
            let sentPlatformMessageId: string | undefined;

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

            // Stale-backlog suppression: scoped strictly to re-enqueued jobs.
            // When a handoff pause expires and queued messages come back, anything
            // older than one pause window is conversational backlog — replying to
            // a 20-min-old "is this in stock?" looks broken, not helpful. Only
            // gates re-enqueued jobs (wasHandoffPaused=true) so unrelated lateness
            // (queue lag, restarts, retries) still gets processed normally.
            if (wasHandoffPaused && storedMessage.createdAt) {
                const ageMs = Date.now() - new Date(storedMessage.createdAt).getTime();
                if (ageMs > pauseMinutes * 60 * 1000) {
                    pipelineMetrics.record(pipeline, 'handoff_backlog_stale');
                    this.logger.info(`[${platform}] Skipping — handoff backlog stale`, {
                        senderId, pageId: page.id, ageMs, pauseMinutes,
                    });
                    return { success: false, messageId: platformMessageId, error: 'Handoff backlog stale' };
                }
            }

            if (!rateCheck.allowed) {
                pipelineMetrics.record(pipeline, 'rate_limited');
                this.logger.info(`[${platform}] Message rate limited`, { senderId, count: rateCheck.count });
                return { success: false, messageId: platformMessageId, error: 'Rate limited' };
            }

            if (!isMessagesEnabled) {
                const customerLang = detectTemplateLanguage(messageText);
                // Two distinct "off" states share this branch (the enabled check folds
                // them): outside business hours — temporary, an away notice is accurate —
                // and messagesAutoReply=false — a standing merchant choice with no
                // "later". On the permanent branch only merchant-authored text may
                // speak for the merchant (allowDefault:false → null when none is
                // configured, and the send below is skipped). Off means off: we never
                // invent copy for a channel the merchant explicitly disabled.
                const awayMessage = await workspaceSettingsService.getAwayMessage(workspaceId, customerLang, {
                    allowDefault: Boolean(userSettings.messagesAutoReply),
                });
                // Send at most once per sender per 24h — NOT once per lifetime.
                //
                // History: gating on `isNew` suppressed the away message entirely (the
                // webhook controller pre-stores the message, so `isNew` is always false
                // by the time the worker runs). The fix used `isFirstIncomingMessage`,
                // which overcorrected into "once per customer, ever": a customer who
                // wrote months ago and writes again tonight gets NOTHING — no smart
                // reply (hours are off) and no acknowledgment either. That is how a
                // live merchant's returning customers went completely unanswered.
                //
                // A 24h window matches Meta's messaging window: within one window the
                // customer is told once, and the merchant can still reply to that same
                // conversation.
                if (awayMessage && await this.shouldSendAwayMessage(page.id, senderId)) {
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

            // 9b. Handle the Messenger "Get Started" opener.
            //
            // Industry-standard flow (Intercom / Drift / ManyChat / Tidio): the
            // Messenger "Get Started" / "بدء الاستخدام" button is designed by
            // Facebook to kick off the conversation. It is the ONLY trigger for
            // the merchant's configured welcome (owner ruling 2026-08-17): toggle
            // on = the tap gets their welcome; toggle off = the tap is silently
            // suppressed. Nothing else fires the greeting.
            //
            // The welcome used to ALSO be prepended to the AI answer on a
            // customer's first typed message, with `suppressGreeting` telling the
            // model not to greet again. Measured in prod (2026-08-17, 207 first
            // contacts): when the first message IS a bare greeting («مرحبا»),
            // "begin directly with the answer" is unsatisfiable — there is no
            // question — so the model greeted back, and ~30% of first contacts
            // got a visible double welcome. The prepend and the suppressGreeting
            // plumbing are gone: a typed first message goes straight to the AI,
            // which greets naturally on first contact.
            //
            // Branches:
            //   (1) Opener tap + greetingMessageEnabled=true + non-empty
            //       configured text + no prior bot DM → the greeting IS the
            //       whole reply.
            //   (2) Any other opener tap (toggle off, empty text, bot already
            //       engaged, send failed) → silently suppress. Never let the
            //       "Get Started" system phrase reach the AI; it produces
            //       confused replies.
            //
            // NOTE: do NOT gate on `isNew` here. The webhook controller stores the message
            // before enqueuing the worker job (see webhook.ts findOrCreateFromWebhook), so
            // by the time we reach this code `storeIncomingMessage` re-finds the same row
            // and returns isNew=false. Gating on isNew would make this entire block dead
            // code for the normal webhook → worker path.
            const isOpener = isOpenerMessage(messageText);

            // SHARED-INFRASTRUCTURE SAFETY NOTE — processMessage is the path EVERY incoming
            // DM/message flows through. This block is scoped to be safe: it only executes
            // for opener taps — typed messages (the overwhelming majority) never enter it.
            // The per-(pageId,senderId) reply lock + the hasOutgoingMessage check make the
            // greeting idempotent across BullMQ retries.
            if (isOpener) {
                const settings = await workspaceSettingsService.getSettings(workspaceId);
                const configured = settings.greetingMessageEnabled
                    ? await workspaceSettingsService.getGreetingMessage(workspaceId, detectTemplateLanguage(messageText))
                    : null;

                // Greet only a genuinely fresh contact. In dual/private comment-reply mode
                // the bot may have ALREADY sent this customer a detailed DM (the private
                // reply to their comment, stored as an outgoing row — see commentProcessor),
                // so a welcome here would greet someone the bot is mid-conversation with.
                // The outgoing-row check also makes the greeting idempotent across retries.
                // Only query for prior engagement when a greeting is actually configured.
                const botAlreadyEngaged = configured
                    ? await messagesService.hasOutgoingMessage(page.id, senderId)
                    : false;

                if (configured && !botAlreadyEngaged) {
                    // (1) Opener tap ("Get Started" / "بدء الاستخدام") — there is no
                    // question to answer, so the greeting IS the whole reply.
                    try {
                        const greetingPlatformMessageId = await adapter.sendReply(page, senderId, configured);
                        await messagesService.storeOutgoingMessage(
                            page.id, workspaceId, senderId, configured, 'template',
                            undefined, undefined, undefined, undefined, undefined,
                            greetingPlatformMessageId,
                        );
                        await messagesService.markAsReplied(storedMessage.id, configured, 'template');
                        this.logger.info(`[${platform}] Sent greeting message`, { senderId, source: 'opener' });
                        pipelineMetrics.record(pipeline, 'greeting_sent');
                        return { success: true, messageId: platformMessageId, replyText: configured, replyMethod: 'template' as const };
                    } catch (error) {
                        // Send failed — fall through to the opener-suppress branch so the
                        // "Get Started" system phrase never reaches the AI.
                        // KNOWN LIMITATION: if sendReply succeeds but a later storeOutgoingMessage
                        // throws, a BullMQ retry can re-greet (no outgoing row was committed).
                        // hasOutgoingMessage only mitigates once a row lands; the send→store-fail
                        // window pre-dates this change and is not closed here.
                        this.logger.error(`[${platform}] Failed to send greeting message`, { error: String(error), willFallbackToAI: false });
                    }
                }

                // (2) Opener reaching here = greeting disabled/empty, bot already engaged,
                // or send failed. Never let the opener system phrase reach AI — silent + return.
                await messagesService.markAsReplied(storedMessage.id, '', 'template');
                this.logger.info(`[${platform}] Suppressed opener tap silently`, { senderId });
                pipelineMetrics.record(pipeline, 'greeting_suppressed');
                return { success: true, messageId: platformMessageId, replyText: '', replyMethod: 'template' as const };
            }

            // 10. Reply delay (doubles as consolidation window when > 0). Jittered
            //     0.5×–1.5× so replies don't land at a constant time (see
            //     computeHumanDelayMs and the ReplyDelayCard copy it matches).
            if (replyDelay > 0) {
                await this.delay(computeHumanDelayMs(replyDelay));
            }
            lap('10-replyDelay');

            // 11. Consolidate all unreplied messages from this sender
            // Note: no post-delay re-check here. If newer messages arrived during the
            // delay, step 11 will include them in the consolidation below. A post-delay
            // skip would cause the newer message to be dropped: Worker 2 already bailed
            // at step 4b ("Lock held"), so nobody would process it.
            const unrepliedMessages = await messagesService.getUnrepliedFromSender(page.id, senderId);

            // 11-pre. Attachment-enrichment PARK (store-then-enrich). A sibling
            // attachment from this sender is stored as a 'pending' stub the instant
            // its webhook lands, then enriched asynchronously. Replying while such a
            // stub is still pending would answer the bare "[صورة]" placeholder — or,
            // if the stub isn't yet in this set, the text alone (blind). So we park:
            // re-enqueue this job with a short delay and let the attachment's own
            // finalize→enqueue (or this job's own retry) consolidate the real content.
            //   • Age-gated: a 'pending' stub older than pendingEnrichmentMaxAgeMs(platform)
            //     means the enricher crashed (webhook already ACKed, no redelivery) —
            //     treat it as not-pending so no DM waits on a corpse.
            //   • Placed BEFORE `didReachConsolidation = true` so a parked return never
            //     arms the finally-block orphan recheck (which would inline-reprocess
            //     and recurse).
            //   • Cap enforced HERE (not in the worker) so exhaustion falls through to
            //     a real reply — the customer is never stranded.
            const now = Date.now();
            const pendingRows = unrepliedMessages.filter(m =>
                m.enrichmentStatus === 'pending'
                && m.createdAt
                && now - new Date(m.createdAt).getTime() < pendingEnrichmentMaxAgeMs(platform),
            );
            if (pendingRows.length > 0 && attachmentRetries < maxAttachmentRetries(platform)) {
                pipelineMetrics.record(pipeline, 'attachment_park');
                this.logger.info(`[${platform}] Attachment enrichment in flight — parking DM`, {
                    senderId, pageId: page.id, attachmentRetries, pendingCount: pendingRows.length,
                });
                return {
                    success: false,
                    messageId: platformMessageId,
                    error: 'Attachment enrichment pending',
                    attachmentPendingDelayMs: ATTACHMENT_PARK_DELAY_MS,
                };
            }
            if (pendingRows.length > 0) {
                // Budget exhausted (enricher crashed / too slow). Reply now WITHOUT the
                // pending rows — they stay replied=false (excluded from handledIds below)
                // and are answered later by their own finalize→enqueue or the orphan
                // recheck. Degrades to today's "second reply", never a wrong first one.
                pipelineMetrics.record(pipeline, 'attachment_park_exhausted');
                this.logger.warn(`[${platform}] Attachment wait budget exhausted — replying without pending rows`, {
                    senderId, pageId: page.id, attachmentRetries, pendingCount: pendingRows.length,
                });
            }

            // The rows we actually consolidate + mark replied. Excludes any still-pending
            // stub so a cap-exhausted reply can't sweep it (see markOlderMessagesAsReplied).
            const consolidatable = pendingRows.length > 0
                ? unrepliedMessages.filter(m => m.enrichmentStatus !== 'pending')
                : unrepliedMessages;
            for (const m of consolidatable) handledPlatformMessageIds.add(m.platformMessageId);
            didReachConsolidation = true;
            lap('11-consolidate');

            // Use latest message for template matching (reflects current intent),
            // but full consolidation for AI context (gives conversation history).
            const latestMessageText = consolidatable.length > 0
                ? consolidatable[consolidatable.length - 1].message
                : messageText;
            const consolidatedText = consolidatable.length > 1
                ? consolidatable.map(m => m.message).join('\n')
                : messageText;

            // 11a. Silently drop emoji-only / punctuation-only mid-conversation messages.
            // Mirrors the sticker path in nonTextHandler.ts: a 🥰 / 👍 / "..." sent after
            // the bot has already engaged carries no conversational intent, and regenerating
            // through the AI causes a fresh "how can I help you today?" greeting that reads
            // as if the conversation restarted (see screenshots 2026-05-20). The greeting
            // branch at step 9b has already returned for first-contact cases, so reaching
            // here means we are mid-conversation. `isPunctuationOnly` requires no letters
            // and no digits in any script, so real replies like "ok", "نعم", or "٠٠٠"
            // still flow through normally.
            if (isPunctuationOnly(consolidatedText.trim())) {
                await this.markSkippedAsResolved(consolidatable, storedMessage.id, workspaceId);
                this.logger.info(`[${platform}] Skipped emoji/punctuation-only mid-conversation message`, { senderId, platformMessageId });
                pipelineMetrics.record(pipeline, 'skipped_spam');
                return { success: true, messageId: platformMessageId };
            }

            // 11b-12. Three INDEPENDENT I/O calls that used to be awaited one after another,
            // putting a Meta Graph round-trip in front of two database reads that need
            // nothing from it:
            //
            //   11b typingIndicator.show()     Redis SETNX + Meta Graph sender_action
            //   11c resolveOriginPostMessage()  DB
            //   12  enrichPageContext()         DB (+ e-commerce API when a store is linked)
            //
            // Now: 11b is fire-and-forget, and 11c/12 run concurrently.
            //
            // 11b. Typing indicator — FIRE-AND-FORGET, never awaited.
            //
            // Messenger already claimed it at webhook receipt, so the dedup claim makes
            // this a no-op there (see typingIndicator.showOnce). Instagram has no receipt
            // hook, so this is where its indicator fires. Either way a cosmetic Meta Graph
            // round-trip — prod Sentry puts Meta calls at 295-1,088 ms average — must not
            // sit on the reply's critical path. Cleanup reads Redis instead of a return
            // value; see the `finally` block.
            typingCall = typingIndicator.show(adapter, page, senderId, platformMessageId);

            // 11c-12. Two INDEPENDENT database reads, run concurrently rather than in
            // sequence. Measured through processMessage with one read stubbed at 15 ms:
            // 320 ms serial → 303 ms concurrent. Tens of milliseconds, scaling with real DB
            // and e-commerce latency — the large win in this area was removing the awaited
            // Meta call above, not this.
            //
            // A rejection from either read still propagates out of `Promise.all` exactly as
            // it did when each was awaited on its own line.
            const [originPostMessage, enriched] = await Promise.all([
                // 11c. If this DM thread originated from a comment on a post, carry the
                // post text into the generator context (same field the comment pipeline
                // uses). Without this, short follow-ups like "تكلفة" or "اوقات الدوام"
                // are classified as SPAM_OR_IRRELEVANT because the AI sees them out of context.
                this.resolveOriginPostMessage(page.id, senderId),
                // 12. Enrich KB with e-commerce data if linked.
                (async () => {
                    // The fact-list matcher reads the customer's recent USER turns plus
                    // the consolidated burst — an area stated once, minutes before the
                    // follow-up («شن أسامي الصيدليات؟»), must keep matching for the rest
                    // of the conversation, and the burst window is seconds-scale. Same
                    // window the model itself sees (the generator's limit-12 recipe), so
                    // the gate is exactly as informed as the model's visible history.
                    // Re-fetched here rather than threaded out of the generator for the
                    // same reason the post-send verifier re-fetches: threading it through
                    // generateForMessage's shared input would touch every caller for one
                    // indexed read. A failed read degrades to burst-only matching — the
                    // pre-H-1 behaviour — never to a failed reply.
                    let matchHistory: { role: 'user' | 'assistant'; content: string }[] = [];
                    try {
                        matchHistory = (await messagesService.getConversationHistory(page.id, senderId, 12)) ?? [];
                    } catch { /* burst-only matching */ }
                    return enrichPageContext(
                        page as unknown as Record<string, unknown>,
                        userSettings,
                        messageText,
                        page.knowledgeBase || undefined,
                        composeFactMatchText(matchHistory, consolidatedText),
                    );
                })(),
            ]);
            lap('11b-12-preAiParallel');
            const { knowledgeBase, storePolicies, productCatalog, brandVoiceNotes, ecommerceStoreId, businessInfoBlock, factCollectionsBlock, factCollectionsGated } = enriched;

            const generated =
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
                        replyMode: resolveEffectiveReplyMode(page.replyMode, userSettings.replyMode),
                        brandVoiceNotes,
                        businessInfoBlock,
                        factCollectionsBlock,
                        factCollectionsGated,
                        ecommerceStoreId: typeof ecommerceStoreId === 'string' ? ecommerceStoreId : undefined,
                        defaultReplyLanguage: userSettings.defaultReplyLanguage,
                        timezone: userSettings.timezone,
                    },
                    userSettings.aiEnabled ?? false,
                );
            // Only replyText is reassigned below (fallback substitution); the rest are const.
            let replyText = generated.replyText;
            const { replyMethod, needsAttention, flagReason, flagMeta, aiIntent, confidence, productCards, replyShortened } = generated;
            lap('12-generateReply');

            // Capture the original AI-generated reply before any modifications (fallback substitution)
            const aiOriginalReply = replyMethod === 'ai' ? (replyText ?? undefined) : undefined;

            // 12b. Replace with safe fallback if AI hallucinated a price
            if (shouldUseFallback(flagReason, aiIntent)) {
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
                    // Spam/irrelevant (incl. conversation-closers like "no thank you") —
                    // no flag, no notification. Resolve so the inbox shows "handled"
                    // instead of a false "will reply soon" badge that never clears.
                    await this.markSkippedAsResolved(consolidatable, storedMessage.id, workspaceId);
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
                    { messageId: storedMessage.id, type: 'message', deepLink: '/messages?filter=flagged', urgent: true },
                ).catch(err => this.logger.error('Offensive message notification failed', { err }));
                pipelineMetrics.record(pipeline, 'skipped_risky');
                return { success: true, messageId: platformMessageId };
            }

            // 12c-bis. Withhold exhausted self-identification strips (always on, no
            // setting): Check 6 removed the ENTIRE reply — all reveal talk — and the
            // validator no longer substitutes a canned identity line (it answered
            // "who are you?" whatever the customer asked; prod, Jawab24 page,
            // 2026-08-01). Nothing defensible to send → flag for merchant review.
            //
            // Ordering is load-bearing in BOTH directions:
            //   - BEFORE 12d: a low-confidence exhausted reply would otherwise be
            //     stored as `held_low_confidence` with an EMPTY draft, giving the
            //     merchant a review affordance with nothing in it.
            //   - BEFORE the !replyText guard: its success:false re-enqueues and
            //     re-bills the same doomed generation.
            //
            // Deliberately `flagMessage`, NOT `markAsReplied('')` like 12d: nothing
            // was sent, so the row must stay unreplied (a false replied/repliedAt
            // corrupts response-time reporting), and there is no draft worth
            // reviewing — the pre-strip text IS the automation reveal, so putting it
            // in the merchant's composer would leave the forbidden line one tap from
            // the customer. Same row shape as the 12c offensive skip.
            if (shouldHoldReply(flagReason)) {
                await messagesService.flagMessage(
                    storedMessage.id, 'held_self_identification', aiIntent,
                );
                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'flagged_reply',
                    { senderName: senderName || senderId, reason: 'held_self_identification' },
                    { messageId: storedMessage.id, type: 'message', deepLink: '/messages?filter=flagged' },
                ).catch(err => this.logger.error('Held reply notification failed', { err }));
                // The customer's message still carries whatever they volunteered —
                // a phone number, an order detail. Withholding OUR reply must not
                // discard THEIR lead, so capture runs here as well as on the send
                // path (the shared capture below is downstream of this return).
                leadExtractorService.maybeCaptureLead({
                    pageId: page.id,
                    userId,
                    workspaceId,
                    sourceId: storedMessage.id,
                    sourceType: 'message',
                    senderId,
                    senderName,
                    replyMode: resolveEffectiveReplyMode(page.replyMode, userSettings.replyMode),
                    messageText: consolidatedText,
                }).catch(() => { /* errors captured inside maybeCaptureLead */ });
                pipelineMetrics.record(pipeline, 'held_self_identification');
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

            // 12e. Platform max message length (Facebook=2000, Instagram=1000).
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
            try {
                // The platform's own id for this send (WhatsApp wamid), when the channel
                // returns one. Persisted on the outgoing row at step 15 so a Coexistence
                // echo of this message is recognised as ours, not as a human reply.
                //
                // A revoked page credential is re-mintable in ONE Graph call, so the
                // customer in front of us must not pay for it: re-mint and retry once
                // before this counts as a lost reply. Recovering in `recordSendFailure`
                // below only helps message N+1 — the message that EXPOSED the dead token
                // still went unanswered, which is the 2026-08-14 outage in miniature.
                // Bounded to one retry by `withPageTokenRetry`, and only entered on a
                // token-revoked code (every other failure rethrows untouched).
                //
                // Facebook-credential platforms only — see `ownsFacebookCredential`.
                sentPlatformMessageId = ownsFacebookCredential(platform, page)
                    ? await withPageTokenRetry(page, (accessToken) => {
                        // Adopt the token for the REST of the pipeline, not just this
                        // call. `sendProductCards` below reads `page.accessToken` and
                        // would otherwise issue the follow-up card send with the exact
                        // credential we just proved dead — a silent card loss on the
                        // one path that had already recovered. A no-op on the first
                        // attempt, where this IS `page.accessToken`.
                        page.accessToken = accessToken;
                        return adapter.sendReply(page, senderId, replyText);
                    })
                    : await adapter.sendReply(page, senderId, replyText);
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
                pipelineMetrics.record(pipeline, 'send_failed');
                this.logger.error(`[${platform}] Failed to send reply`, { error: String(error) });
                // Defensive auto-pause: bump page-level failure counter (fire-and-forget).
                // Only page-level buckets (`our_fault` / `unknown`) count toward the
                // threshold; `customer_refused` / `window_expired` are per-customer.
                // Transient errors already re-thrown above never reach here.
                // classifyDmError is Facebook/Instagram-only; for other platforms we
                // pass no bucket (treated as page-level `unknown` by the helper).
                const dmFailure = (platform === 'facebook' || platform === 'instagram')
                    ? classifyDmError(error, platform)
                    : undefined;
                // `error` (not just the bucket) so a revoked credential can be
                // re-minted on the spot instead of waiting for ten more losses.
                void recordSendFailure(page.id, dmFailure?.bucket, platform, error);
                // SSE: notify merchant of failed reply
                publishSSEEvent(userId, 'message:reply_failed', {
                    messageId: platformMessageId,
                    pageId: page.id,
                    error: 'Failed to send reply',
                });
                // Still mark message as replied with delivery_failed flag so it doesn't
                // stay in "Needs Action" forever. The AI did its job — delivery is a
                // platform issue. The classified failure (bucket/code/subcode/fbMessage)
                // is persisted in flag_meta so the row alone answers "failed WHY" — the
                // comment path always stored this; the DM path discarding it cost a full
                // evening of live probing to rediscover one error code (MES, 2026-08-08).
                await messagesService.markAsReplied(
                    storedMessage.id, replyText, replyMethod,
                    true, 'delivery_failed', aiIntent, undefined, aiOriginalReply,
                    dmFailure ? buildDmFailedFlagMeta(dmFailure) : null,
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
                await messagesService.markAsReplied(storedMessage.id, replyText, replyMethod, needsAttention, flagReason, aiIntent, tx, aiOriginalReply, flagMeta);

                // 15. Store outgoing message. The reply_shortened marker rides the
                // OUTGOING row's flagMeta (quiet inbox badge) — the incoming row's
                // alarm flagMeta above stays untouched by it.
                const stored = await messagesService.storeOutgoingMessage(
                    page.id, workspaceId, senderId, replyText, replyMethod, tx,
                    undefined, undefined, undefined,
                    replyShortened ? { reply_shortened: {} } : undefined,
                    sentPlatformMessageId,
                );
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

                // 16. Mark the consolidated messages as replied. Scoped to the exact
                // ids we consolidated (not "everything unreplied") so an attachment
                // stub that finalized mid-generation isn't swept under this reply.
                if (consolidatable.length > 1) {
                    markedOlder = await messagesService.markOlderMessagesAsReplied(
                        page.id, senderId, consolidatable.map(m => m.id), storedMessage.id, replyText, replyMethod, tx,
                    );
                }
            });
            lap('15-postReply');

            if (markedOlder > 0) {
                this.logger.info(`[${platform}] Marked older debounced messages as replied`, { count: markedOlder, senderId });
            }

            // Defensive auto-pause: any successful send resets the failure streak —
            // the page-level one, and this platform's channel streak (only this
            // platform's: a Facebook success must not hide a dead Instagram).
            void recordSendSuccess(page.id, platform);

            // 17. Notify if flagged — use enriched reason for high-stakes flags
            if (needsAttention && page.userId) {
                const notifyReason = buildNotificationReason(flagReason, consolidatedText);
                const urgent = isUrgentNotification(flagReason, aiIntent);

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

            // Activation funnel: this page just sent an automated reply. Idempotent —
            // only the first send per user is recorded (unique user_id+event index).
            void recordActivationEvent(userId, 'first_autoreply_sent', { pageId: page.id, channel: 'message', replyMethod });
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
                replyMode: resolveEffectiveReplyMode(page.replyMode, userSettings.replyMode),
                messageText: consolidatedText,
            }).catch(() => { /* errors captured inside maybeCaptureLead */ });

            // Fire-and-forget grounding verification (SYSTEM_ANALYSIS gap 13).
            // Detection only: it flags the stored row, never the sent reply.
            // Off unless GROUNDING_VERIFY_ENABLED=true, so this is inert until
            // switched on.
            //
            // The verifier must judge against EXACTLY what the generator saw —
            // no more, no less (owner ruling 2026-07-30):
            //   • originPostMessage = origin post + its Post Reply trigger,
            //     which the AI is allowed to quote (#467). Omitting it made
            //     every legitimate post quote look invented on Post-Reply-heavy
            //     pages (found on الدمشقي).
            //   • factCollectionsBlock = the rendered <business_lists> rows. The
            //     model answers list questions FROM these; judging without them
            //     would flag every correct list answer as invented.
            //   • history = the generator's own recipe (getConversationHistory
            //     limit 12, minus turns matching the current text), re-fetched
            //     here because verification runs after the send. The extra read
            //     is gated first so the fleet-wide path pays nothing, and it is
            //     off the reply latency path entirely (reply already sent). The
            //     assistant-side filter also drops the just-stored outgoing
            //     reply, which did not exist when the generator read history.
            {
                const groundingKb = buildGroundingSource({ knowledgeBase, postMessage: originPostMessage, storePolicies, productCatalog, factCollectionsBlock, businessInfoBlock });
                if (shouldVerifyGrounding({ pageId: page.id, replyMethod, intent: aiIntent, reply: replyText ?? '', kb: groundingKb })) {
                    const sentReply = replyText ?? '';
                    messagesService.getConversationHistory(page.id, senderId, 12)
                        .then(hist => groundingVerifierService.maybeVerifyGrounding({
                            userId,
                            pageId: page.id,
                            sourceId: storedMessage.id,
                            sourceType: 'message',
                            kb: groundingKb,
                            persona: brandVoiceNotes,
                            question: consolidatedText,
                            reply: sentReply,
                            intent: aiIntent,
                            replyMethod,
                            history: hist
                                .filter(m => !(m.role === 'user' && m.content === consolidatedText))
                                .filter(m => !(m.role === 'assistant' && m.content === sentReply))
                                .map(m => (m.role === 'user' ? { q: m.content, a: null } : { q: null, a: m.content })),
                        }))
                        .catch(() => { /* errors captured inside maybeVerifyGrounding */ });
                }
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
                consolidatedCount: consolidatable.length,
                durationMs: Date.now() - t0,
            });

            return { success: true, messageId: platformMessageId, replyText, replyMethod };

            } finally {
                await releaseReplyLock(page.id, senderId, lockToken).catch(() => { /* TTL will auto-expire */ });

                // Clear the typing indicator if we showed one but never sent a reply
                // (spam-skip, hold, empty AI output, non-transient delivery failure,
                // transient error rethrow). The happy path's outgoing message
                // dismisses the indicator automatically.
                //
                // ABORT PATH ONLY — the `!replySent` short-circuit runs first, so a
                // delivered reply pays neither the settle nor the Redis read.
                //
                // Awaiting `typingCall` here is what keeps the fire-and-forget send exact:
                // a reply that aborts DURING the Meta round-trip would otherwise read Redis
                // while the claim still says "attempted", conclude nothing was shown, and
                // strand the indicator for ~20s. On Messenger this resolves instantly (the
                // webhook already claimed it, so step 11b was a dedup no-op).
                if (!replySent && typingCall) {
                    await typingCall.catch(() => false);
                    if (await typingIndicator.wasShown(page.id, platformMessageId)) {
                        typingIndicator.clear(adapter, page, senderId);
                    }
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
     * Away-message cooldown: true when this sender has not been sent one within
     * the last `AWAY_MESSAGE_COOLDOWN_SECONDS`.
     *
     * On a Redis outage we send anyway — an occasional duplicate acknowledgment
     * is a far smaller failure than silence (same trade-off as the non-text
     * nudge cooldown in nonTextHandler.sendNudge).
     */
    private async shouldSendAwayMessage(pageId: string, senderId: string): Promise<boolean> {
        try {
            const acquired = await redis.set(
                `away_msg:${pageId}:${senderId}`, '1', 'EX', AWAY_MESSAGE_COOLDOWN_SECONDS, 'NX',
            );
            return acquired !== null;
        } catch {
            return true;
        }
    }

    /**
     * Mark a deliberately-skipped message (and any consolidated siblings) as resolved.
     *
     * Shared by the emoji/punctuation drop (11a) and the spam/irrelevant silent skip
     * (12c). Both decide no reply is warranted, so both MUST leave a terminal state —
     * otherwise the message stays replied=false/resolved=false and the inbox renders a
     * false "will reply soon" badge that never resolves (isPending in MessageCard).
     *
     * Mirrors the comment pipeline's silentlyResolveAndSkip: resolving changes the
     * needs-attention/handled counts, so the cached workspace stats must be invalidated
     * too or the inbox header tallies stay stale until the next unrelated event.
     */
    private async markSkippedAsResolved(
        unrepliedMessages: { id: string }[],
        storedMessageId: string,
        workspaceId: string,
    ): Promise<void> {
        for (const m of unrepliedMessages) {
            await messagesService.markAsResolved(m.id);
        }
        if (!unrepliedMessages.some(m => m.id === storedMessageId)) {
            await messagesService.markAsResolved(storedMessageId);
        }
        invalidateWorkspaceStatsCache(workspaceId);
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

            // Pass attachmentRetries = MAX so the recheck can NEVER park: its result
            // is discarded (nobody re-enqueues it), so a parked return would strand
            // the orphan. Forcing it past the park gate makes it reply — consolidating
            // any 'done' attachment, or (in the rare concurrent-enrich corner) the
            // text alone. wasHandoffPaused stays false.
            await this.processMessage(
                adapter,
                platformPageId,
                senderId,
                newest.message,
                newest.platformMessageId,
                undefined,
                undefined,
                false,
                maxAttachmentRetries(adapter.platform),
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
     * Resolve the originating post/media context for a conversation when the DM
     * thread started from a comment (dual or private mode). Returns undefined
     * when there is no origin link, the referenced row is missing (deleted), or
     * the post is older than MAX_ORIGIN_POST_AGE_MS (staleness guard).
     *
     * Returns the post text COMPOSED with the merchant's Post Reply (trigger
     * reply) when one is configured. Both are merchant-authored, so both are
     * legitimate fact sources for the [current_post] prompt block — the post
     * caption is often short/price-less while the Post Reply carries the actual
     * price/details (the صيدلية زينب عباس incident: 93-char caption, price only
     * in the 914-char trigger reply → AI deflected a price question and the
     * customer called it fraud). The post text is capped here so the composed
     * string's tail (the reply, where the price usually lives) can never be
     * truncated by the prompt builder's overall cap.
     *
     * Looks up in `posts` (facebook) or `instagram_media` (instagram) based on
     * the conversation's platform. No FK on `origin_content_id` — if the row
     * was deleted, we silently degrade to no context rather than erroring.
     */
    private async resolveOriginPostMessage(pageId: string, senderId: string): Promise<string | undefined> {
        const conversation = await conversationsService.findByPageAndSender(pageId, senderId);
        if (!conversation?.originContentId) return undefined;

        const lookup = conversation.platform === 'instagram'
            ? db.select({ message: instagramMedia.caption, createdAt: instagramMedia.createdAt, triggerReply: instagramMedia.triggerReply })
                .from(instagramMedia).where(eq(instagramMedia.id, conversation.originContentId))
            : db.select({ message: posts.message, createdAt: posts.createdTime, triggerReply: posts.triggerReply })
                .from(posts).where(eq(posts.id, conversation.originContentId));

        const [row] = await lookup;
        if (!row) return undefined;

        const postText = row.message?.trim();
        const triggerReply = row.triggerReply?.trim();
        if (!postText && !triggerReply) return undefined;

        const postedAt = row.createdAt ?? null;
        if (!postedAt || Date.now() - postedAt.getTime() >= MAX_ORIGIN_POST_AGE_MS) {
            return undefined;
        }

        const parts: string[] = [];
        if (postText) parts.push(postText.slice(0, ORIGIN_POST_TEXT_CAP));
        if (triggerReply) {
            // Trigger replies are product-capped at POST_REPLY_MAX_REPLY_LEN (1000), so no slice here.
            parts.push(`---\n[The merchant's automatic reply already sent to this customer for this post]\n${triggerReply}`);
        }
        return parts.join('\n');
    }
}

export const messageProcessor = new MessageProcessor();

// --- Urgent notification helpers ---

// Re-export for backward compatibility (tests and other importers)
export { URGENT_FLAG_MAP, isUrgentFlag, buildNotificationReason } from './urgentFlags';
