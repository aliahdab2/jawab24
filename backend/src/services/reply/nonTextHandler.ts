import { pagesService } from '../pages';
import { messagesService } from '../messages';
import { facebookService } from '../facebook';
import { instagramService } from '../instagram';
import { transcriptionService } from '../transcription';
import { redis } from '../../lib/redis';
import { enqueueMessage } from '../../lib/replyQueue';
import { detectLanguageCode } from '../../utils/language';
import { getAttachmentPlaceholder, getTextOnlyNudge } from '../../utils/attachmentLabels';
import { instagramMessageAdapter } from './adapters';
import type { Logger } from '../../types';

/** Get the platform-prefixed message ID for DB storage (must match adapter dedup keys) */
function getPrefixedMessageId(messageId: string, platform: 'facebook' | 'instagram'): string {
    return platform === 'instagram'
        ? instagramMessageAdapter.getInternalMessageId(messageId)
        : messageId;
}

/** Cooldown TTL: 1 hour. Prevents spamming the same customer with nudge replies. */
const NUDGE_COOLDOWN_SECONDS = 3600;

export interface NonTextMessageEvent {
    senderId: string;
    messageId: string;
    attachmentType: string;
    attachmentUrl?: string;
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
    const { senderId, messageId, attachmentType, attachmentUrl } = event;

    try {
        // 1. Look up the page
        const page = platform === 'facebook'
            ? await pagesService.getPageByFacebookId(platformPageId)
            : await pagesService.getPageByInstagramId(platformPageId);

        if (!page?.accessToken) return;

        // 2. Detect language from sender's previous text messages (default: Arabic)
        let lang: 'ar' | 'en' = 'ar';
        try {
            const lastText = await messagesService.getLastIncomingTextFromSender(page.id, senderId);
            if (lastText) {
                const detected = detectLanguageCode(lastText);
                if (detected === 'en') lang = 'en';
            }
        } catch { /* default to Arabic */ }

        // 3. Attempt Whisper transcription for audio messages
        if (attachmentType === 'audio' && attachmentUrl) {
            const result = await transcriptionService.transcribe(attachmentUrl, lang);

            if (result) {
                logger.info(`[${platform}] Voice message transcribed`, {
                    senderId, textLength: result.text.length,
                });

                // Store transcribed text in DB (not placeholder)
                await messagesService.findOrCreateFromWebhook(
                    page.id, getPrefixedMessageId(messageId, platform), senderId, result.text, undefined, 'audio',
                );

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

        // 4. Non-audio or failed transcription: store placeholder + send nudge
        const placeholder = getAttachmentPlaceholder(attachmentType, lang);
        await messagesService.findOrCreateFromWebhook(
            page.id, getPrefixedMessageId(messageId, platform), senderId, placeholder, undefined, attachmentType,
        );

        // 5. Check cooldown — one nudge per sender per page per hour
        const cooldownKey = `nontext_nudge:${page.id}:${senderId}`;
        let alreadySent = false;
        try {
            const result = await redis.set(
                cooldownKey, '1', 'EX', NUDGE_COOLDOWN_SECONDS, 'NX',
            );
            alreadySent = result === null;
        } catch {
            // Redis unavailable — send nudge anyway (better than silence)
        }

        if (alreadySent) {
            logger.debug(`[${platform}] Non-text nudge cooldown active`, { senderId });
            return;
        }

        // 6. Send the nudge reply
        const nudgeText = getTextOnlyNudge(lang);

        if (platform === 'facebook') {
            await facebookService.sendPrivateMessage(page.accessToken, senderId, nudgeText);
        } else {
            const igAccountId = page.instagramAccountId;
            if (igAccountId) {
                await instagramService.sendDirectMessage(
                    igAccountId, senderId, nudgeText, page.accessToken,
                );
            }
        }

        // 7. Store the outgoing nudge
        await messagesService.storeOutgoingMessage(page.id, senderId, nudgeText, 'template');

        logger.info(`[${platform}] Non-text nudge sent`, { senderId, attachmentType });
    } catch (error) {
        logger.error(`[${platform}] Failed to handle non-text message`, {
            messageId, error: String(error),
        });
    }
}
