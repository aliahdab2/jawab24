import { pagesService } from '../pages';
import { messagesService } from '../messages';
import { facebookService } from '../facebook';
import { instagramService } from '../instagram';
import { transcriptionService } from '../transcription';
import { redis } from '../../lib/redis';
import { enqueueMessage } from '../../lib/replyQueue';
import { detectLanguageCode } from '../../utils/language';
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
    const { senderId, messageId, attachmentType, attachmentUrl, attachmentId, attachmentTitle } = event;

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
            const result = await transcriptionService.transcribe(attachmentUrl, lang);

            if (result) {
                logger.info(`[${platform}] Voice message transcribed`, {
                    senderId, textLength: result.text.length,
                });

                // Store transcribed text in DB (not placeholder)
                await messagesService.findOrCreateFromWebhook(
                    page.id, workspaceId, messageId, senderId, result.text, senderName, 'audio',
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

            await messagesService.findOrCreateFromWebhook(
                page.id, workspaceId, messageId, senderId, enrichedText, senderName, attachmentType,
            );

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

        // 6. Non-audio or failed transcription: store placeholder + send generic nudge
        const placeholder = getAttachmentPlaceholder(attachmentType, lang);
        await messagesService.findOrCreateFromWebhook(
            page.id, workspaceId, messageId, senderId, placeholder, senderName, attachmentType,
        );
        await sendNudge(page, workspaceId, senderId, getTextOnlyNudge(lang), platform, logger);
    } catch (error) {
        logger.error(`[${platform}] Failed to handle non-text message`, {
            messageId, error: String(error),
        });
    }
}

/**
 * Send a nudge reply with cooldown (1 per sender per page per hour).
 * Shared by all non-text handlers to avoid duplicating cooldown + send + store logic.
 */
async function sendNudge(
    page: { id: string; accessToken: string; instagramAccountId?: string | null },
    workspaceId: string,
    senderId: string,
    nudgeText: string,
    platform: 'facebook' | 'instagram',
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
