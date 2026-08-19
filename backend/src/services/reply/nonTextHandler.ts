import { pagesService, invalidateWorkspaceStatsCache } from '../pages';
import { messagesService } from '../messages';
import { facebookService } from '../facebook';
import { instagramService } from '../instagram';
import { instagramCredentialOf, resolveInstagramCredential, type InstagramCredential } from '../instagramCredential';
import { whatsappService } from '../whatsapp';
import { transcriptionService } from '../transcription';
import { imageUnderstandingService, checkImageUnderstandingGate, incrementImageUnderstandingCounter, notifyImageCapReached } from '../imageUnderstanding';
import { redis } from '../../lib/redis';
import { enqueueMessage } from '../../lib/replyQueue';
import { publishSSEEvent } from '../../lib/eventBus';
import { detectLanguageCode } from '../../utils/language';
import { t } from '../../utils/i18n';
import { getAttachmentPlaceholder, getTextOnlyNudge, NO_INTENT_ATTACHMENT_TYPES } from '../../utils/attachmentLabels';
import { extractPostId, isSharedPostType } from '../../utils/instagram';
import { facebookMessageAdapter } from './adapters/facebookAdapter';
import { instagramMessageAdapter } from './adapters/instagramAdapter';
import type { Logger } from '../../types';

/** Cooldown TTL: 1 hour. Prevents spamming the same customer with nudge replies. */
const NUDGE_COOLDOWN_SECONDS = 3600;

/**
 * Store-then-enrich: persist an attachment row the instant its webhook lands, with a
 * placeholder body (e.g. "[صورة]") and — when the attachment will be enriched —
 * `enrichment_status='pending'`. This makes the attachment visible in the merchant
 * inbox immediately (SSE `message:received`), and lets the reply pipeline PARK on the
 * pending stub (messageProcessor step 11) instead of answering the bare placeholder
 * or the sibling text alone. Enrichment then replaces the text via `finalizeEnrichment`.
 *
 * Returns the stored row + isNew. On webhook redelivery `isNew=false` and the caller
 * decides whether to re-run enrichment (only for a still-'pending' row).
 */
async function storeAttachmentStub(opts: {
    page: { id: string; userId?: string | null };
    workspaceId: string;
    messageId: string;
    senderId: string;
    senderName: string | undefined;
    placeholder: string;
    attachmentType: string;
    isEnrichable: boolean;
    platformTimestamp?: number;
}): Promise<{ stub: import('@jawab24/shared').Message; isNew: boolean }> {
    const { page, workspaceId, messageId, senderId, senderName, placeholder, attachmentType, isEnrichable, platformTimestamp } = opts;

    const { message: stub, isNew } = await messagesService.findOrCreateFromWebhook(
        page.id, workspaceId, messageId, senderId, placeholder, senderName, attachmentType,
        undefined /* platform: preserve legacy default */, isEnrichable ? 'pending' : undefined,
    );

    if (isNew && typeof platformTimestamp === 'number') {
        await messagesService.setCreatedTime(stub.id, new Date(platformTimestamp));
    }

    // SSE: surface the attachment in the merchant inbox the instant it lands. The
    // enriched content follows via `message:updated`. New rows only — never on retries.
    if (isNew && page.userId) {
        publishSSEEvent(page.userId, 'message:received', {
            messageId,
            pageId: page.id,
            senderId,
            senderName: senderName ?? null,
            message: {
                id: stub.id,
                pageId: page.id,
                platformMessageId: messageId,
                senderId,
                senderName: senderName ?? null,
                message: placeholder,
                direction: 'incoming' as const,
                replied: false,
                replyText: null,
                replyMethod: null,
                createdTime: typeof platformTimestamp === 'number' ? new Date(platformTimestamp).toISOString() : null,
                repliedAt: null,
                createdAt: new Date().toISOString(),
                attachmentType,
            },
        });
        invalidateWorkspaceStatsCache(workspaceId);
    }

    return { stub, isNew };
}

/**
 * Finalize a stub to 'done' with the enriched text, then tell any open merchant
 * thread to swap the placeholder in place (SSE `message:updated`). A false return
 * (nothing updated — already finalized) is logged, not fatal.
 */
async function finalizeAttachmentDone(
    stubId: string,
    text: string,
    page: { id: string; userId?: string | null },
    messageId: string,
    senderId: string,
    logger: Logger,
): Promise<void> {
    const updated = await messagesService.finalizeEnrichment(stubId, 'done', text);
    if (!updated) {
        logger.warn('[nonText] finalizeEnrichment(done) updated no row — already finalized?', { stubId, messageId });
        return;
    }
    if (page.userId) {
        publishSSEEvent(page.userId, 'message:updated', { messageId, pageId: page.id, senderId });
    }
}

/**
 * Terminal exit for an attachment WE failed to enrich: mark the stub failed
 * (releasing any parked sibling text job) and say NOTHING to the customer.
 *
 * Shared by every such exit on both platforms, because the alternative — the
 * same three statements inlined per branch — is how one platform gets a policy
 * change and the other silently does not (§13c: the same timeout-classification
 * bug shipped twice for exactly that reason).
 *
 * Silence, not an apology: the text-only nudge claims we cannot read images,
 * which is false whenever the failure was ours. The photo still reaches the
 * merchant's inbox and the SLA sweep surfaces it as unanswered.
 */
/**
 * What the CUSTOMER hears when an image could not be read. One function, so the
 * policy exists once instead of being re-derived per platform.
 *
 * `nudge` is only correct when the customer can act on it — the guiding question
 * is never "did it fail?" but "can they fix it by sending text instead?".
 */
type ImageDenialAction = 'nudge' | 'silent' | 'silent_notify_cap';

function actionForGateDenial(reason: 'env_disabled' | 'no_subscription' | 'cap_check_failed' | 'cap_reached' | 'subscription_inactive'): ImageDenialAction {
    switch (reason) {
        // The merchant's subscription no longer entitles anything (canceled,
        // paused, past-due beyond grace, expired trial). SILENT, and the reason
        // is not the enum's usual "is the capability available" line — it is that
        // THIS handler runs at ingestion, before messageProcessor's
        // `enforceAutoReplyGate`, and consults no subscription of its own. So a
        // nudge here would be a NEW outbound message to the customer of a
        // merchant who is not paying, telling them to retype their question as
        // text — after which the reply gate blocks the answer and they hear
        // nothing anyway. That is the one case where the nudge's own
        // justification ("the fastest route to an answer") is false: no answer is
        // coming by any route. Staying silent is also what a suspended merchant
        // would want — see the quota story below.
        case 'subscription_inactive':
            return 'silent';
        // The merchant's daily quota is spent: silence for the customer, and the
        // merchant — never their customer — is told.
        case 'cap_reached':
            return 'silent_notify_cap';
        // A Redis/DB blip inside our own gate. Image reading is working fine —
        // we just could not check the counter — so «we can only read text» is
        // false. It is also the worst possible moment to say it: during a Redis
        // outage every image sender fleet-wide would hear it, with no suppression
        // either, because sendNudge's cooldown reads the same downed Redis and
        // fails open.
        case 'cap_check_failed':
            return 'silent';
        // Both of these are TRUE statements about a standing configuration, not
        // failures of a working feature: the kill switch is deliberately off, or
        // the workspace has no plan covering image reads. We genuinely cannot
        // read this photo and will not be able to on a retry, so telling the
        // customer to send text is honest AND the fastest route to an answer —
        // silence would just leave them waiting on a reply that is never coming.
        //
        // The line this whole enum draws is "is the capability available right
        // now?" — not "did something go wrong?". A disabled feature is a real
        // limit; a timeout is us failing at something we do all day.
        case 'env_disabled':
        case 'no_subscription':
            return 'nudge';
    }
}

async function finalizeAttachmentFailedSilently(
    stubId: string,
    platform: 'facebook' | 'instagram' | 'whatsapp',
    reason: string,
    logger: Logger,
    ids: { senderId: string; messageId: string },
): Promise<void> {
    await messagesService.finalizeEnrichment(stubId, 'failed');
    logger.warn(`[${platform}] Image not read (${reason}) — staying silent`, ids);
}

export interface NonTextMessageEvent {
    senderId: string;
    messageId: string;
    attachmentType: string;
    attachmentUrl?: string;
    attachmentId?: string;
    attachmentTitle?: string;
    /** Epoch millis from the FB/IG webhook event. Persisted as `created_time`
     *  so the chat sorts by platform send time, not DB insert time. Critical
     *  for images: the handler's pre-store Graph API calls (fetch_sender_name)
     *  can delay the image insert past the outgoing nudge insert, which would
     *  otherwise render the nudge ABOVE the image it replies to. */
    platformTimestamp?: number;
}

/**
 * Handle a non-text message (voice, image, video, file, sticker).
 *
 * For audio messages with a URL: transcribe via Whisper → feed into AI reply pipeline.
 * For everything else (or if transcription fails): store placeholder + send nudge.
 */
export async function handleNonTextMessage(
    platformPageId: string,
    event: NonTextMessageEvent,
    platform: 'facebook' | 'instagram',
    logger: Logger,
): Promise<void> {
    const { senderId, messageId, attachmentType, attachmentUrl, attachmentId, attachmentTitle, platformTimestamp } = event;

    // Set once the pending stub is stored, so a thrown enrichment error can flip it
    // 'failed' (releasing any parked text job) instead of leaving it stuck 'pending'.
    let stubId: string | null = null;

    try {
        // 1. Look up the page
        const page = platform === 'facebook'
            ? await pagesService.getPageByFacebookId(platformPageId)
            : await pagesService.getPageByInstagramId(platformPageId);

        if (!page) return;

        // Which credential this page's sends ride on. An Instagram Login page keeps
        // its Facebook page-token column at the '' sentinel and holds the real
        // credential in `instagram_access_token`, so guarding on `page.accessToken`
        // would drop every voice note, image and sticker such a page receives.
        // Same shape the WhatsApp branch below already uses.
        const igCredential = platform === 'instagram' ? resolveInstagramCredential(page) : null;
        const accessToken = igCredential?.accessToken || page.accessToken;
        if (!accessToken) return;
        const sendPage = { ...page, accessToken, instagramCredential: igCredential ?? undefined };

        // Guard: pages connected since 0073_backfill always have workspace_id; skip orphans.
        if (!page.workspaceId) {
            logger.warn(`[${platform}] Page missing workspace_id — skipping non-text handler`, { pageId: page.id, messageId });
            return;
        }
        const workspaceId = page.workspaceId;

        // 2. Fetch sender name (best-effort) — persisted so dashboard always shows real names,
        //    even for non-text messages that bypass the normal AI pipeline.
        let senderName: string | undefined;
        try {
            const adapter = platform === 'facebook' ? facebookMessageAdapter : instagramMessageAdapter;
            senderName = await adapter.fetchSenderName(senderId, accessToken, page.id, platformPageId, igCredential?.baseUrl);
        } catch { /* non-critical */ }

        // Stickers (including the Facebook 👍 thumbs-up like button) carry no conversational
        // intent — store silently in DB for chat history context but do NOT send a nudge.
        // Mark resolved=true immediately so the escalation cron doesn't flag the row as
        // "needs attention" after the SLA window. The spam-cleanup pass in escalation.ts
        // can't catch this on its own because the stored placeholder "[Sticker]" contains
        // alphabetic letters, so it fails the no-letters spam heuristic.
        if (attachmentType === 'sticker') {
            const { message: stored, isNew } = await messagesService.findOrCreateFromWebhook(
                page.id, workspaceId, messageId, senderId, '[Sticker]', senderName, 'sticker',
            );
            if (isNew && typeof platformTimestamp === 'number') {
                await messagesService.setCreatedTime(stored.id, new Date(platformTimestamp));
            }
            if (isNew) {
                await messagesService.markAsResolved(stored.id);
            }
            logger.debug(`[${platform}] Sticker ignored (no nudge)`, { senderId, messageId });
            return;
        }

        // 3. Detect language from sender's previous text messages (default: Arabic).
        //    Runs before the stub is stored; the stub's placeholder starts with "[" so
        //    it would be skipped anyway.
        let lang: 'ar' | 'en' = 'ar';
        try {
            const lastText = await messagesService.getLastIncomingTextFromSender(page.id, senderId);
            if (lastText) {
                const detected = detectLanguageCode(lastText);
                if (detected === 'en') lang = 'en';
            }
        } catch { /* default to Arabic */ }

        // 4. Will this attachment be enriched into the AI pipeline (vs. just a nudge)?
        //    Audio (transcribe), shared posts (fetch), and images (vision) are; video /
        //    file / unknown are not. Drives whether the stub is stored 'pending' (which
        //    the reply pipeline parks on) or terminal.
        const isEnrichable =
            (attachmentType === 'audio' && !!attachmentUrl) ||
            isSharedPostType(attachmentType) ||
            (attachmentType === 'image' && !!attachmentUrl && !!page.userId);

        const jobType = platform === 'facebook' ? 'facebook_message' : 'instagram_message';

        // 5. STORE-THEN-ENRICH: persist the attachment row NOW with a placeholder body,
        //    so the merchant inbox shows it immediately and the reply pipeline can PARK
        //    on the 'pending' stub instead of answering the bare text. Enrichment below
        //    replaces the text + finalizes the status.
        const placeholder = getAttachmentPlaceholder(attachmentType, lang);
        const { stub, isNew } = await storeAttachmentStub({
            page, workspaceId, messageId, senderId, senderName,
            placeholder, attachmentType, isEnrichable, platformTimestamp,
        });
        stubId = stub.id;

        // 5b. The attachment carries no question at all (story mentions): nothing to
        //     answer ⇒ nothing to nudge about. Mark resolved so the SLA sweep doesn't
        //     file it as an unanswered customer.
        //
        //     Deliberately ABOVE the redelivery guard below. These rows are stored
        //     non-enrichable, so on a retry the guard would return early — and if the
        //     process died between storing the stub and resolving it, that retry is
        //     the only remaining chance to set the flag. Left below the guard, a
        //     crash at the wrong instant strands the row unresolved forever and the
        //     SLA sweep files it as sla_no_reply: the exact symptom this branch
        //     exists to prevent. Guarded on `resolved` (not `isNew`) and
        //     markAsResolved is idempotent, so redelivery is free.
        if (NO_INTENT_ATTACHMENT_TYPES.has(attachmentType)) {
            if (!stub.resolved) await messagesService.markAsResolved(stub.id);
            logger.debug(`[${platform}] No-intent attachment stored, no nudge`, {
                senderId, messageId, attachmentType,
            });
            return;
        }

        // Webhook redelivery of an already-finalized (or non-lifecycle) attachment:
        // nothing to do. A still-'pending' redelivery falls through to re-run enrichment
        // (finalizeEnrichment's pending-guard makes the double-finalize harmless).
        if (!isNew && stub.enrichmentStatus !== 'pending') return;

        // 6. Not enrichable (video / file / unknown; image without url/owner): the
        //    placeholder is terminal — send the text-only nudge, no AI job.
        if (!isEnrichable) {
            await sendNudge(sendPage, workspaceId, senderId, getTextOnlyNudge(lang), platform, logger);
            return;
        }

        // 7. Audio → Whisper transcript → finalize → AI pipeline.
        if (attachmentType === 'audio' && attachmentUrl) {
            // Attribute the transcription cost to the page owner (per-page AI cost).
            // page.userId is nullable; skip attribution (not the transcription) if absent.
            const result = await transcriptionService.transcribe(
                attachmentUrl, lang, undefined,
                page.userId ? { userId: page.userId, pageId: page.id } : undefined,
            );
            if (result) {
                logger.info(`[${platform}] Voice message transcribed`, { senderId, textLength: result.text.length });
                await finalizeAttachmentDone(stub.id, result.text, page, messageId, senderId, logger);
                // pageId must be the platform ID (not internal UUID) — same as webhook.ts
                await enqueueMessage({ jobType, pageId: platformPageId, messageId, senderId, text: result.text });
                return; // AI pipeline handles the reply from here
            }
            logger.warn(`[${platform}] Voice transcription failed, falling back to nudge`, { senderId, messageId });
            await messagesService.finalizeEnrichment(stub.id, 'failed');
            await sendNudge(sendPage, workspaceId, senderId, getTextOnlyNudge(lang), platform, logger);
            return;
        }

        // 8. Shared post/reel: fetch content (best-effort), always route to AI.
        if (isSharedPostType(attachmentType)) {
            let postContent: string | null = null;
            try {
                const resolvedId = extractPostId(attachmentUrl, attachmentId);
                if (resolvedId) {
                    const isIg = attachmentType === 'ig_post' || attachmentType === 'ig_reel';
                    postContent = isIg
                        ? await instagramService.getPostContent(resolvedId, instagramCredentialOf(sendPage))
                        : await facebookService.getPostContent(resolvedId, accessToken);
                }
            } catch {
                // Non-critical — continue with fallback context
            }

            // Build the best context we have: content > title > generic marker
            const enrichedText = postContent
                ? `[Shared post: "${postContent.slice(0, 200)}"]`
                : attachmentTitle
                    ? `[Shared post: "${attachmentTitle}"]`
                    : '[Customer shared a post]';

            await finalizeAttachmentDone(stub.id, enrichedText, page, messageId, senderId, logger);
            await enqueueMessage({ jobType, pageId: platformPageId, messageId, senderId, text: enrichedText });
            logger.info(`[${platform}] Shared post enqueued for AI`, {
                senderId, messageId, hasContent: !!postContent, hasTitle: !!attachmentTitle,
            });
            return; // AI pipeline handles the reply from here
        }

        // 9. Customer image: read it with AI vision → finalize → normal reply pipeline.
        //    Gated by the env kill switch + per-plan daily cap. Every denial and
        //    failure finalizes 'failed' (the placeholder stands); what differs is
        //    what the CUSTOMER is told, and that turns on whose fault it was:
        //      • image unusable (oversized / wrong format / malformed) → nudge,
        //        because "send it as text instead" is honest and actionable;
        //      • our failure (vision timeout, network, dead CDN link) → SILENCE;
        //      • daily cap reached → SILENCE + notify the merchant.
        //    Never claim we cannot read images: we can, and usually do.
        if (attachmentType === 'image' && attachmentUrl && page.userId) {
            const gate = await checkImageUnderstandingGate(page.userId, workspaceId);
            if (gate.allowed) {
                const outcome = await imageUnderstandingService.describeFromUrl(
                    attachmentUrl, lang, { userId: gate.ownerId, pageId: page.id },
                );
                if (outcome.ok) {
                    const body = t('attachmentImageDescribed', lang, { description: outcome.text });
                    await finalizeAttachmentDone(stub.id, body, page, messageId, senderId, logger);
                    await incrementImageUnderstandingCounter(gate.ownerId);
                    await enqueueMessage({ jobType, pageId: platformPageId, messageId, senderId, text: body });
                    logger.info(`[${platform}] Customer image understood`, { senderId, descriptionLength: outcome.text.length });
                    return; // AI pipeline handles the reply from here
                }
                if (outcome.reason === 'our_failure') {
                    // WE failed on a readable image — the vision deadline fired, the
                    // network broke, or the CDN link died. Prod 2026-08-11: a guest
                    // photographed a bad meal to complain and got «حالياً نستطيع الرد
                    // على الرسائل النصية والصوتية» 20.7s later, because a timeout and
                    // "this file is not an image" both returned null and took the
                    // same exit.
                    await finalizeAttachmentFailedSilently(stub.id, platform, 'our_failure', logger, { senderId, messageId });
                    return;
                }
                // 'unusable_image' — oversized, or rejected by OpenAI as malformed.
                // The customer CAN act on this, so the nudge is honest here.
                logger.warn(`[${platform}] Image unusable, falling back to nudge`, { senderId, messageId });
            } else {
                const action = actionForGateDenial(gate.reason);
                if (action !== 'nudge') {
                    await finalizeAttachmentFailedSilently(stub.id, platform, gate.reason, logger, { senderId, messageId });
                    // One merchant watched the nudge reach five of his customers
                    // after his quota ran out and wrote «لما زبون يرسلك صورة لا ترد
                    // عليه» into his Business Info to stop it. He wanted silence —
                    // and to be told himself, which is what this does.
                    if (action === 'silent_notify_cap' && gate.reason === 'cap_reached') {
                        await notifyImageCapReached(gate.ownerId, gate.limit);
                    }
                    return;
                }
                logger.info(`[${platform}] Image understanding gated (${gate.reason}), falling back to nudge`, { senderId, messageId });
            }
            await messagesService.finalizeEnrichment(stub.id, 'failed');
            await sendNudge(sendPage, workspaceId, senderId, getTextOnlyNudge(lang), platform, logger);
            return;
        }
    } catch (error) {
        logger.error(`[${platform}] Failed to handle non-text message`, {
            messageId, error: String(error),
        });
        // Don't leave a stub stuck 'pending' (would make the reply pipeline park until
        // the age cutoff). Flip it 'failed' so any parked text job proceeds promptly.
        if (stubId) {
            await messagesService.finalizeEnrichment(stubId, 'failed').catch(() => { /* best-effort */ });
        }
    }
}

/** Non-text WhatsApp webhook message, normalized by the webhook controller. */
export interface WhatsAppNonTextEvent {
    senderId: string;
    messageId: string;
    /** WhatsApp webhook message type: audio | image | video | document | sticker */
    attachmentType: string;
    /** Cloud API media ID — resolved to a short-lived authorized URL on demand */
    mediaId?: string;
    mimeType?: string;
    senderName?: string;
    /** Epoch millis from the webhook `timestamp` (seconds) — see NonTextMessageEvent */
    platformTimestamp?: number;
}

/**
 * WhatsApp variant of handleNonTextMessage. Separate function because media
 * access differs structurally from FB/IG: the webhook carries a media ID, not
 * a URL, and the download requires the WABA bearer token (so the generic
 * transcribe-from-URL path can't be reused).
 */
export async function handleWhatsAppNonTextMessage(
    phoneNumberId: string,
    event: WhatsAppNonTextEvent,
    logger: Logger,
): Promise<void> {
    const { senderId, messageId, attachmentType, mediaId, mimeType, senderName, platformTimestamp } = event;

    // See handleNonTextMessage: flip a stored stub 'failed' on a thrown error so a
    // parked text job doesn't wait on it until the age cutoff.
    let stubId: string | null = null;

    try {
        const page = await pagesService.getPageByWhatsAppPhoneNumberId(phoneNumberId);
        if (!page?.whatsappAccessToken) return;
        const whatsappAccessToken = page.whatsappAccessToken;

        if (!page.workspaceId) {
            logger.warn('[whatsapp] Page missing workspace_id — skipping non-text handler', { pageId: page.id, messageId });
            return;
        }
        const workspaceId = page.workspaceId;

        // Stickers carry no conversational intent — store silently (same as FB/IG).
        if (attachmentType === 'sticker') {
            const { message: stored, isNew } = await messagesService.findOrCreateFromWebhook(
                page.id, workspaceId, messageId, senderId, '[Sticker]', senderName, 'sticker',
            );
            if (isNew && typeof platformTimestamp === 'number') {
                await messagesService.setCreatedTime(stored.id, new Date(platformTimestamp));
            }
            if (isNew) {
                await messagesService.markAsResolved(stored.id);
            }
            logger.debug('[whatsapp] Sticker ignored (no nudge)', { senderId, messageId });
            return;
        }

        // Detect language from sender's previous text messages (default: Arabic)
        let lang: 'ar' | 'en' = 'ar';
        try {
            const lastText = await messagesService.getLastIncomingTextFromSender(page.id, senderId);
            if (lastText) {
                const detected = detectLanguageCode(lastText);
                if (detected === 'en') lang = 'en';
            }
        } catch { /* default to Arabic */ }

        // Enrichable = voice note or (image with owner). Everything else is a nudge.
        const isEnrichable =
            (attachmentType === 'audio' && !!mediaId) ||
            (attachmentType === 'image' && !!mediaId && !!page.userId);

        // STORE-THEN-ENRICH: persist the row immediately. WhatsApp `document` uses the
        // `file` placeholder label; the stored attachmentType stays the raw webhook type.
        const placeholderType = attachmentType === 'document' ? 'file' : attachmentType;
        const placeholder = getAttachmentPlaceholder(placeholderType, lang);
        const { stub, isNew } = await storeAttachmentStub({
            page, workspaceId, messageId, senderId, senderName,
            placeholder, attachmentType, isEnrichable, platformTimestamp,
        });
        stubId = stub.id;

        // Same no-intent rule as FB/IG, and above the redelivery guard for the same
        // reason. WhatsApp has no story mentions today, so this is a no-op here —
        // it exists so the set governs BOTH platforms rather than looking shared
        // while being enforced on one, which is how the two paths drift apart.
        if (NO_INTENT_ATTACHMENT_TYPES.has(attachmentType)) {
            if (!stub.resolved) await messagesService.markAsResolved(stub.id);
            logger.debug('[whatsapp] No-intent attachment stored, no nudge', { senderId, messageId, attachmentType });
            return;
        }

        if (!isNew && stub.enrichmentStatus !== 'pending') return;

        const waNudge = () => sendNudge(
            { id: page.id, accessToken: whatsappAccessToken, whatsappPhoneNumberId: phoneNumberId },
            workspaceId, senderId, getTextOnlyNudge(lang), 'whatsapp', logger,
        );

        // Not enrichable (document / video / unknown): placeholder is terminal → nudge.
        if (!isEnrichable) {
            await waNudge();
            return;
        }

        // Voice note → download with the WABA token → Whisper → finalize → AI pipeline.
        if (attachmentType === 'audio' && mediaId) {
            try {
                const media = await whatsappService.getMediaInfo(mediaId, whatsappAccessToken);
                const buffer = media.url
                    ? await whatsappService.downloadMedia(media.url, whatsappAccessToken)
                    : null;
                if (buffer) {
                    // Whisper rejects codec suffixes like "audio/ogg; codecs=opus"
                    const cleanMime = (mimeType ?? media.mimeType).split(';')[0].trim();
                    const result = await transcriptionService.transcribeFromBuffer(
                        buffer, cleanMime, lang, undefined,
                        page.userId ? { userId: page.userId, pageId: page.id } : undefined,
                    );
                    if (result) {
                        logger.info('[whatsapp] Voice message transcribed', { senderId, textLength: result.text.length });
                        await finalizeAttachmentDone(stub.id, result.text, page, messageId, senderId, logger);
                        await enqueueMessage({ jobType: 'whatsapp_message', pageId: phoneNumberId, messageId, senderId, text: result.text, senderName });
                        return; // AI pipeline handles the reply from here
                    }
                }
            } catch (error) {
                logger.warn('[whatsapp] Voice media fetch failed, falling back to nudge', { senderId, messageId, error: String(error) });
            }
            logger.warn('[whatsapp] Voice transcription failed, falling back to nudge', { senderId, messageId });
            await messagesService.finalizeEnrichment(stub.id, 'failed');
            await waNudge();
            return;
        }

        // Customer image → download with the WABA token → AI vision → finalize → pipeline.
        // Captioned WhatsApp images take the webhook's caption-as-text path and don't
        // reach here (enriching those is a follow-up).
        if (attachmentType === 'image' && mediaId && page.userId) {
            const gate = await checkImageUnderstandingGate(page.userId, workspaceId);
            if (gate.allowed) {
                // Mirrors the FB/IG path above: only an unusable IMAGE earns the
                // nudge. Anything that went wrong on our side — WABA media fetch,
                // vision timeout, network — must stay silent rather than tell the
                // customer we cannot read photos.
                let ourFailure = false;
                try {
                    const media = await whatsappService.getMediaInfo(mediaId, whatsappAccessToken);
                    const buffer = media.url
                        ? await whatsappService.downloadMedia(media.url, whatsappAccessToken)
                        : null;
                    if (buffer) {
                        const cleanMime = (mimeType ?? media.mimeType).split(';')[0].trim();
                        const outcome = await imageUnderstandingService.describeFromBuffer(
                            buffer, cleanMime, lang, { userId: gate.ownerId, pageId: page.id },
                        );
                        if (outcome.ok) {
                            const body = t('attachmentImageDescribed', lang, { description: outcome.text });
                            await finalizeAttachmentDone(stub.id, body, page, messageId, senderId, logger);
                            await incrementImageUnderstandingCounter(gate.ownerId);
                            await enqueueMessage({ jobType: 'whatsapp_message', pageId: phoneNumberId, messageId, senderId, text: body, senderName });
                            logger.info('[whatsapp] Customer image understood', { senderId, descriptionLength: outcome.text.length });
                            return;
                        }
                        ourFailure = outcome.reason === 'our_failure';
                    } else {
                        // WhatsApp gave us no media URL — Meta's side or ours, but
                        // certainly not something the customer can fix.
                        ourFailure = true;
                    }
                } catch (error) {
                    // WABA media fetch broke. The image itself was never assessed.
                    logger.warn('[whatsapp] Image media fetch failed', { senderId, messageId, error: String(error) });
                    ourFailure = true;
                }
                if (ourFailure) {
                    await finalizeAttachmentFailedSilently(stub.id, 'whatsapp', 'our_failure', logger, { senderId, messageId });
                    return;
                }
                logger.warn('[whatsapp] Image unusable, falling back to nudge', { senderId, messageId });
            } else {
                // Same policy function as FB/IG — until 2026-08-11 this branch
                // nudged for EVERY denial including cap_reached, so a WhatsApp
                // merchant's customers got the false "we can only read text"
                // message and the merchant was never told his quota had run out.
                const action = actionForGateDenial(gate.reason);
                if (action !== 'nudge') {
                    await finalizeAttachmentFailedSilently(stub.id, 'whatsapp', gate.reason, logger, { senderId, messageId });
                    if (action === 'silent_notify_cap' && gate.reason === 'cap_reached') {
                        await notifyImageCapReached(gate.ownerId, gate.limit);
                    }
                    return;
                }
                logger.info(`[whatsapp] Image understanding gated (${gate.reason}), falling back to nudge`, { senderId, messageId });
            }
            await messagesService.finalizeEnrichment(stub.id, 'failed');
            await waNudge();
            return;
        }
    } catch (error) {
        logger.error('[whatsapp] Failed to handle non-text message', {
            messageId, error: String(error),
        });
        if (stubId) {
            await messagesService.finalizeEnrichment(stubId, 'failed').catch(() => { /* best-effort */ });
        }
    }
}

/**
 * Send a nudge reply with cooldown (1 per sender per page per hour).
 * Shared by all non-text handlers to avoid duplicating cooldown + send + store logic.
 * For WhatsApp, `accessToken` carries the WABA business token.
 */
async function sendNudge(
    page: {
        id: string;
        accessToken: string;
        instagramAccountId?: string | null;
        whatsappPhoneNumberId?: string | null;
        /** Instagram host + credential when the caller already resolved one. */
        instagramCredential?: InstagramCredential;
    },
    workspaceId: string,
    senderId: string,
    nudgeText: string,
    platform: 'facebook' | 'instagram' | 'whatsapp',
    logger: Logger,
): Promise<void> {
    const cooldownKey = `nontext_nudge:${page.id}:${senderId}`;
    let alreadySent = false;
    try {
        const result = await redis.set(cooldownKey, '1', 'EX', NUDGE_COOLDOWN_SECONDS, 'NX');
        alreadySent = result === null;
    } catch {
        // Redis unavailable — send nudge anyway (better than silence)
    }

    if (alreadySent) {
        logger.debug(`[${platform}] Non-text nudge cooldown active`, { senderId });
        return;
    }

    // Platform's own id for this send (WhatsApp wamid), persisted below so a
    // Coexistence echo of the nudge is recognised as ours rather than as the
    // merchant answering from their phone.
    let sentPlatformMessageId: string | undefined;

    if (platform === 'facebook') {
        await facebookService.sendPrivateMessage(page.accessToken, senderId, nudgeText);
    } else if (platform === 'whatsapp') {
        if (page.whatsappPhoneNumberId) {
            sentPlatformMessageId = await whatsappService.sendTextMessage(
                page.whatsappPhoneNumberId, senderId, nudgeText, page.accessToken,
            ) || undefined;
        }
    } else {
        if (page.instagramAccountId) {
            await instagramService.sendDirectMessage(
                page.instagramAccountId, senderId, nudgeText, instagramCredentialOf(page),
            );
        }
    }

    await messagesService.storeOutgoingMessage(
        page.id, workspaceId, senderId, nudgeText, 'template',
        undefined, undefined, undefined, undefined, undefined,
        sentPlatformMessageId,
    );
    logger.info(`[${platform}] Nudge sent`, { senderId });
}
