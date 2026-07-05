import { pagesService } from '../pages';
import { messagesService } from '../messages';
import { facebookService } from '../facebook';
import { instagramService } from '../instagram';
import { whatsappService } from '../whatsapp';
import { transcriptionService } from '../transcription';
import { imageUnderstandingService, checkImageUnderstandingGate, incrementImageUnderstandingCounter } from '../imageUnderstanding';
import { redis } from '../../lib/redis';
import { enqueueMessage } from '../../lib/replyQueue';
import { detectLanguageCode } from '../../utils/language';
import { t } from '../../utils/i18n';
import { getAttachmentPlaceholder, getTextOnlyNudge } from '../../utils/attachmentLabels';
import { extractPostId, isSharedPostType } from '../../utils/instagram';
import { facebookMessageAdapter } from './adapters/facebookAdapter';
import { instagramMessageAdapter } from './adapters/instagramAdapter';
import type { Logger } from '../../types';

/** Cooldown TTL: 1 hour. Prevents spamming the same customer with nudge replies. */
const NUDGE_COOLDOWN_SECONDS = 3600;

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

    try {
        // 1. Look up the page
        const page = platform === 'facebook'
            ? await pagesService.getPageByFacebookId(platformPageId)
            : await pagesService.getPageByInstagramId(platformPageId);

        if (!page?.accessToken) return;

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
            senderName = await adapter.fetchSenderName(senderId, page.accessToken, page.id, platformPageId);
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

        // 3. Detect language from sender's previous text messages (default: Arabic)
        let lang: 'ar' | 'en' = 'ar';
        try {
            const lastText = await messagesService.getLastIncomingTextFromSender(page.id, senderId);
            if (lastText) {
                const detected = detectLanguageCode(lastText);
                if (detected === 'en') lang = 'en';
            }
        } catch { /* default to Arabic */ }

        // 4. Attempt Whisper transcription for audio messages
        if (attachmentType === 'audio' && attachmentUrl) {
            // Attribute the transcription cost to the page owner so it shows up in
            // per-page AI cost tracking. page.userId is nullable; skip attribution
            // (not the transcription) if a legacy page has no owner row.
            const result = await transcriptionService.transcribe(
                attachmentUrl, lang, undefined,
                page.userId ? { userId: page.userId, pageId: page.id } : undefined,
            );

            if (result) {
                logger.info(`[${platform}] Voice message transcribed`, {
                    senderId, textLength: result.text.length,
                });

                // Store transcribed text in DB (not placeholder)
                const { message: storedAudio, isNew: isNewAudio } = await messagesService.findOrCreateFromWebhook(
                    page.id, workspaceId, messageId, senderId, result.text, senderName, 'audio',
                );
                if (isNewAudio && typeof platformTimestamp === 'number') {
                    await messagesService.setCreatedTime(storedAudio.id, new Date(platformTimestamp));
                }

                // Enqueue for the normal AI reply pipeline
                // pageId must be the platform ID (not internal UUID) — same as webhook.ts processMessage
                const jobType = platform === 'facebook' ? 'facebook_message' : 'instagram_message';
                await enqueueMessage({
                    jobType,
                    pageId: platformPageId,
                    messageId,
                    senderId,
                    text: result.text,
                });

                return; // AI pipeline handles the reply from here
            }

            // Transcription failed — fall through to nudge
            logger.warn(`[${platform}] Voice transcription failed, falling back to nudge`, {
                senderId, messageId,
            });
        }

        // 5. Shared post/reel: fetch content (best-effort), always route to AI
        if (isSharedPostType(attachmentType)) {
            let postContent: string | null = null;
            try {
                const resolvedId = extractPostId(attachmentUrl, attachmentId);
                if (resolvedId) {
                    const isIg = attachmentType === 'ig_post' || attachmentType === 'ig_reel';
                    postContent = isIg
                        ? await instagramService.getPostContent(resolvedId, page.accessToken)
                        : await facebookService.getPostContent(resolvedId, page.accessToken);
                }
            } catch {
                // Non-critical — continue with fallback context
            }

            // Build the best context we have: content > title > generic marker
            let enrichedText: string;
            if (postContent) {
                enrichedText = `[Shared post: "${postContent.slice(0, 200)}"]`;
            } else if (attachmentTitle) {
                enrichedText = `[Shared post: "${attachmentTitle}"]`;
            } else {
                enrichedText = '[Customer shared a post]';
            }

            const { message: storedShared, isNew: isNewShared } = await messagesService.findOrCreateFromWebhook(
                page.id, workspaceId, messageId, senderId, enrichedText, senderName, attachmentType,
            );
            if (isNewShared && typeof platformTimestamp === 'number') {
                await messagesService.setCreatedTime(storedShared.id, new Date(platformTimestamp));
            }

            const jobType = platform === 'facebook' ? 'facebook_message' : 'instagram_message';
            await enqueueMessage({
                jobType,
                pageId: platformPageId,
                messageId,
                senderId,
                text: enrichedText,
            });

            logger.info(`[${platform}] Shared post enqueued for AI`, {
                senderId, messageId,
                hasContent: !!postContent, hasTitle: !!attachmentTitle,
            });
            return; // AI pipeline handles the reply from here
        }

        // 6. Customer image: read it with AI vision → feed the description into the
        //    normal reply pipeline (mirrors audio transcription). Gated by the env
        //    kill switch + per-plan daily cap. Any denial or failure falls through
        //    to the placeholder + nudge below, so behavior never regresses.
        if (attachmentType === 'image' && attachmentUrl && page.userId) {
            const gate = await checkImageUnderstandingGate(page.userId, workspaceId);
            if (gate.allowed) {
                const described = await imageUnderstandingService.describeFromUrl(
                    attachmentUrl, lang, { userId: gate.ownerId, pageId: page.id },
                );
                if (described) {
                    const body = t('attachmentImageDescribed', lang, { description: described.text });
                    const { message: storedImg, isNew: isNewImg } = await messagesService.findOrCreateFromWebhook(
                        page.id, workspaceId, messageId, senderId, body, senderName, 'image',
                    );
                    if (isNewImg && typeof platformTimestamp === 'number') {
                        await messagesService.setCreatedTime(storedImg.id, new Date(platformTimestamp));
                    }
                    await incrementImageUnderstandingCounter(gate.ownerId);

                    const jobType = platform === 'facebook' ? 'facebook_message' : 'instagram_message';
                    await enqueueMessage({ jobType, pageId: platformPageId, messageId, senderId, text: body });
                    logger.info(`[${platform}] Customer image understood`, { senderId, descriptionLength: described.text.length });
                    return; // AI pipeline handles the reply from here
                }
                logger.warn(`[${platform}] Image understanding failed, falling back to nudge`, { senderId, messageId });
            } else {
                logger.info(`[${platform}] Image understanding gated (${gate.reason}), falling back to nudge`, { senderId, messageId });
            }
        }

        // 7. Non-audio or failed transcription: store placeholder + send generic nudge
        const placeholder = getAttachmentPlaceholder(attachmentType, lang);
        const { message: storedAtt, isNew: isNewAtt } = await messagesService.findOrCreateFromWebhook(
            page.id, workspaceId, messageId, senderId, placeholder, senderName, attachmentType,
        );
        if (isNewAtt && typeof platformTimestamp === 'number') {
            await messagesService.setCreatedTime(storedAtt.id, new Date(platformTimestamp));
        }
        await sendNudge(page, workspaceId, senderId, getTextOnlyNudge(lang), platform, logger);
    } catch (error) {
        logger.error(`[${platform}] Failed to handle non-text message`, {
            messageId, error: String(error),
        });
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

    try {
        const page = await pagesService.getPageByWhatsAppPhoneNumberId(phoneNumberId);
        if (!page?.whatsappAccessToken) return;

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

        // Voice note → download with the WABA token → Whisper → normal AI pipeline
        if (attachmentType === 'audio' && mediaId) {
            try {
                const media = await whatsappService.getMediaInfo(mediaId, page.whatsappAccessToken);
                const buffer = media.url
                    ? await whatsappService.downloadMedia(media.url, page.whatsappAccessToken)
                    : null;

                if (buffer) {
                    // Whisper rejects codec suffixes like "audio/ogg; codecs=opus"
                    const cleanMime = (mimeType ?? media.mimeType).split(';')[0].trim();
                    const result = await transcriptionService.transcribeFromBuffer(
                        buffer, cleanMime, lang, undefined,
                        page.userId ? { userId: page.userId, pageId: page.id } : undefined,
                    );

                    if (result) {
                        logger.info('[whatsapp] Voice message transcribed', {
                            senderId, textLength: result.text.length,
                        });

                        const { message: storedAudio, isNew: isNewAudio } = await messagesService.findOrCreateFromWebhook(
                            page.id, workspaceId, messageId, senderId, result.text, senderName, 'audio',
                        );
                        if (isNewAudio && typeof platformTimestamp === 'number') {
                            await messagesService.setCreatedTime(storedAudio.id, new Date(platformTimestamp));
                        }

                        await enqueueMessage({
                            jobType: 'whatsapp_message',
                            pageId: phoneNumberId,
                            messageId,
                            senderId,
                            text: result.text,
                            senderName,
                        });
                        return; // AI pipeline handles the reply from here
                    }
                }
            } catch (error) {
                logger.warn('[whatsapp] Voice media fetch failed, falling back to nudge', {
                    senderId, messageId, error: String(error),
                });
            }
            logger.warn('[whatsapp] Voice transcription failed, falling back to nudge', { senderId, messageId });
        }

        // Customer image → download with the WABA token → AI vision → normal pipeline.
        // Same gate + fallback as FB/IG. Captioned WhatsApp images take the webhook's
        // caption-as-text path and don't reach here (enriching those is a follow-up).
        if (attachmentType === 'image' && mediaId && page.userId) {
            const gate = await checkImageUnderstandingGate(page.userId, workspaceId);
            if (gate.allowed) {
                try {
                    const media = await whatsappService.getMediaInfo(mediaId, page.whatsappAccessToken);
                    const buffer = media.url
                        ? await whatsappService.downloadMedia(media.url, page.whatsappAccessToken)
                        : null;
                    if (buffer) {
                        const cleanMime = (mimeType ?? media.mimeType).split(';')[0].trim();
                        const described = await imageUnderstandingService.describeFromBuffer(
                            buffer, cleanMime, lang, { userId: gate.ownerId, pageId: page.id },
                        );
                        if (described) {
                            const body = t('attachmentImageDescribed', lang, { description: described.text });
                            const { message: storedImg, isNew: isNewImg } = await messagesService.findOrCreateFromWebhook(
                                page.id, workspaceId, messageId, senderId, body, senderName, 'image',
                            );
                            if (isNewImg && typeof platformTimestamp === 'number') {
                                await messagesService.setCreatedTime(storedImg.id, new Date(platformTimestamp));
                            }
                            await incrementImageUnderstandingCounter(gate.ownerId);
                            await enqueueMessage({
                                jobType: 'whatsapp_message', pageId: phoneNumberId, messageId, senderId, text: body, senderName,
                            });
                            logger.info('[whatsapp] Customer image understood', { senderId, descriptionLength: described.text.length });
                            return;
                        }
                    }
                } catch (error) {
                    logger.warn('[whatsapp] Image media fetch failed, falling back to nudge', { senderId, messageId, error: String(error) });
                }
                logger.warn('[whatsapp] Image understanding failed, falling back to nudge', { senderId, messageId });
            } else {
                logger.info(`[whatsapp] Image understanding gated (${gate.reason}), falling back to nudge`, { senderId, messageId });
            }
        }

        // Everything else (or failed transcription): placeholder + text-only nudge.
        // WhatsApp `document` maps onto the existing `file` placeholder label.
        const placeholderType = attachmentType === 'document' ? 'file' : attachmentType;
        const placeholder = getAttachmentPlaceholder(placeholderType, lang);
        const { message: storedAtt, isNew: isNewAtt } = await messagesService.findOrCreateFromWebhook(
            page.id, workspaceId, messageId, senderId, placeholder, senderName, attachmentType,
        );
        if (isNewAtt && typeof platformTimestamp === 'number') {
            await messagesService.setCreatedTime(storedAtt.id, new Date(platformTimestamp));
        }
        await sendNudge(
            { id: page.id, accessToken: page.whatsappAccessToken, whatsappPhoneNumberId: phoneNumberId },
            workspaceId, senderId, getTextOnlyNudge(lang), 'whatsapp', logger,
        );
    } catch (error) {
        logger.error('[whatsapp] Failed to handle non-text message', {
            messageId, error: String(error),
        });
    }
}

/**
 * Send a nudge reply with cooldown (1 per sender per page per hour).
 * Shared by all non-text handlers to avoid duplicating cooldown + send + store logic.
 * For WhatsApp, `accessToken` carries the WABA business token.
 */
async function sendNudge(
    page: { id: string; accessToken: string; instagramAccountId?: string | null; whatsappPhoneNumberId?: string | null },
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

    if (platform === 'facebook') {
        await facebookService.sendPrivateMessage(page.accessToken, senderId, nudgeText);
    } else if (platform === 'whatsapp') {
        if (page.whatsappPhoneNumberId) {
            await whatsappService.sendTextMessage(
                page.whatsappPhoneNumberId, senderId, nudgeText, page.accessToken,
            );
        }
    } else {
        if (page.instagramAccountId) {
            await instagramService.sendDirectMessage(
                page.instagramAccountId, senderId, nudgeText, page.accessToken,
            );
        }
    }

    await messagesService.storeOutgoingMessage(page.id, workspaceId, senderId, nudgeText, 'template');
    logger.info(`[${platform}] Nudge sent`, { senderId });
}
