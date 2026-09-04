import { pagesService } from '../../pages';
import { renderReplyForChannel } from '@jawab24/shared';
import { conversationsService } from '../../conversations';
import { whatsappService, WhatsAppApiError, META_TOKEN_EXPIRED } from '../../whatsapp';
import { markWhatsAppNeedsReconnect } from '../../whatsappTokenHealth';
import { mapToPlatformPage, storeIncomingMessage as storeMessage, markAsReplied as sharedMarkAsReplied } from './shared';
import type { MessagePlatformAdapter, PlatformPage, StoredMessage } from '../../../interfaces';

/**
 * WhatsApp Platform Adapter
 *
 * Implements platform-specific behavior for WhatsApp DMs.
 * Follows the same pattern as Facebook and Instagram adapters.
 */
export class WhatsAppMessageAdapter implements MessagePlatformAdapter {
    readonly platform = 'whatsapp' as const;
    readonly maxReplyLength = 4096;

    async getPage(whatsappPhoneNumberId: string): Promise<PlatformPage | null> {
        const page = await pagesService.getPageByWhatsAppPhoneNumberId(whatsappPhoneNumberId);
        if (!page) return null;
        // WhatsApp sends authenticate with the Embedded Signup business token,
        // not the Facebook page token that accessToken normally carries.
        return mapToPlatformPage({ ...page, accessToken: page.whatsappAccessToken ?? '' }, {
            autoReplyEnabled: page.whatsappAutoReplyEnabled ?? false,
            platformAccountId: page.whatsappPhoneNumberId ?? undefined,
        });
    }

    async fetchSenderName(senderId: string, _accessToken: string, pageId?: string): Promise<string | undefined> {
        // WhatsApp has no profile API — sender name comes from webhook contacts[].profile.name.
        // Only the canonical conversations table; no Graph API lookup exists to fall back to.
        if (pageId) {
            const canonical = await conversationsService.getSenderName(pageId, senderId);
            if (canonical) return canonical;
        }
        return undefined;
    }

    async storeIncomingMessage(
        pageId: string,
        workspaceId: string,
        whatsappMessageId: string,
        senderId: string,
        text: string,
        senderName?: string,
    ): Promise<{ message: StoredMessage; isNew: boolean }> {
        return storeMessage(pageId, workspaceId, whatsappMessageId, senderId, text, senderName, 'whatsapp');
    }

    getInternalMessageId(whatsappMessageId: string): string {
        return whatsappMessageId;
    }

    async sendTypingIndicator(_page: PlatformPage, _senderId: string): Promise<void> {
        // No-op by design: WhatsApp's combined read+typing call requires the wamid
        // (message ID), which this interface doesn't carry. Both are sent at webhook
        // receipt instead (webhook.ts processWhatsAppWebhookAsync) — earlier than
        // this hook would fire, which is what perceived latency needs.
    }

    renderReply(text: string, knownPhones?: string[]): string {
        return renderReplyForChannel(text, 'whatsapp', knownPhones);
    }

    async sendReply(page: PlatformPage, senderId: string, text: string): Promise<string | undefined> {
        if (!page.platformAccountId) {
            throw new Error('Page has no WhatsApp phone number ID');
        }
        // Never issue a send with an empty bearer. `safeDecryptToken` deliberately
        // swallows decryption failures and returns '' (corrupt row, or a rotated /
        // missing FACEBOOK_TOKEN_ENCRYPTION_KEY), and nothing upstream re-checks it.
        // Sending anyway earns a 190 from Meta, which the catch below would read as
        // "this merchant's token expired" — so one key misconfiguration would flag
        // every WhatsApp page on its first inbound message. Fail loudly instead.
        if (!page.accessToken) {
            throw new Error('WhatsApp token unavailable for this page (decrypt failed or not connected)');
        }
        try {
            // RETURN the wamid — the caller persists it as messages.platformMessageId
            // so a Coexistence echo of this very message is recognised as ours rather
            // than as the merchant answering from their phone. Dropping this `return`
            // silently reverts every WhatsApp outgoing row to a synthetic id, with
            // every test still green; the failure would only surface later as the bot
            // muting itself after each reply. See MessagePlatformAdapter.sendReply.
            return await whatsappService.sendTextMessage(
                page.platformAccountId,
                senderId,
                text,
                page.accessToken,
            ) || undefined;
        } catch (error) {
            // Meta forces a 60-day expiry on WhatsApp business tokens, so 190 here is
            // a terminal state, not a blip: no retry can fix it and every subsequent
            // send will fail identically.
            //
            // Flag the number immediately so send #2 is never attempted. Previously an
            // expired token was bucketed 'unknown' and burned PAUSE_THRESHOLD (10)
            // customer messages into delivery_failed before the page auto-paused —
            // with nothing telling the merchant why their WhatsApp went quiet.
            //
            // This lives in the adapter, not messageProcessor, so no
            // `platform === 'whatsapp'` branch leaks into the shared pipeline (D-016).
            if (error instanceof WhatsAppApiError && error.metaCode === META_TOKEN_EXPIRED) {
                await markWhatsAppNeedsReconnect({
                    id: page.id,
                    name: page.name,
                    userId: page.userId,
                    // NOT platformAccountId — that is Meta's numeric phone-number ID,
                    // so the merchant's notification read "your connection for
                    // 1564356725245618 has expired". The sweep passes the real display
                    // number; null here lets the notification fall back to the page name.
                    whatsappDisplayPhoneNumber: null,
                }, 'token_expired');
            }
            throw error;
        }
    }

    async sendAwayMessage(page: PlatformPage, senderId: string, text: string): Promise<void> {
        if (!page.platformAccountId) return;
        try {
            await whatsappService.sendTextMessage(
                page.platformAccountId,
                senderId,
                text,
                page.accessToken,
            );
        } catch {
            // May fail if 24h window expired — template messages needed (phase 2)
        }
    }

    markAsReplied = sharedMarkAsReplied;
}

export const whatsappMessageAdapter = new WhatsAppMessageAdapter();
