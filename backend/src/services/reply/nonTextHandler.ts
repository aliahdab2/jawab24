import { pagesService } from '../pages';
import { messagesService } from '../messages';
import { facebookService } from '../facebook';
import { instagramService } from '../instagram';
import { redis } from '../../lib/redis';
import { detectLanguageCode } from '../../utils/language';
import { getAttachmentPlaceholder, getTextOnlyNudge } from '../../utils/attachmentLabels';
import type { Logger } from '../../types';

/** Cooldown TTL: 1 hour. Prevents spamming the same customer with nudge replies. */
const NUDGE_COOLDOWN_SECONDS = 3600;

export interface NonTextMessageEvent {
    senderId: string;
    messageId: string;
    attachmentType: string;
}

/**
 * Handle a non-text message (voice, image, video, file, sticker).
 * Stores a placeholder in DB so the merchant sees the message,
 * and sends a one-time nudge asking the customer to resend as text.
 */
export async function handleNonTextMessage(
    platformPageId: string,
    event: NonTextMessageEvent,
    platform: 'facebook' | 'instagram',
    logger: Logger,
): Promise<void> {
    const { senderId, messageId, attachmentType } = event;

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

        // 3. Store a placeholder in DB so the merchant sees the message
        const placeholder = getAttachmentPlaceholder(attachmentType, lang);
        await messagesService.findOrCreateFromWebhook(
            page.id, messageId, senderId, placeholder,
        );

        // 4. Check cooldown — one nudge per sender per page per hour
        const cooldownKey = `nontext_nudge:${page.id}:${senderId}`;
        let alreadySent = false;
        try {
            const result = await redis.set(
                cooldownKey, '1', 'EX', NUDGE_COOLDOWN_SECONDS, 'NX',
            );
            alreadySent = result === null; // NX returns null if key already exists
        } catch {
            // Redis unavailable — send nudge anyway (better than silence)
        }

        if (alreadySent) {
            logger.debug(`[${platform}] Non-text nudge cooldown active`, { senderId });
            return;
        }

        // 5. Send the nudge reply
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

        // 6. Store the outgoing nudge
        await messagesService.storeOutgoingMessage(page.id, senderId, nudgeText, 'template');

        logger.info(`[${platform}] Non-text nudge sent`, { senderId, attachmentType });
    } catch (error) {
        logger.error(`[${platform}] Failed to handle non-text message`, {
            messageId, error: String(error),
        });
    }
}
