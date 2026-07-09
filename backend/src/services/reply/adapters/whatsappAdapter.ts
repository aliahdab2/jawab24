import { pagesService } from '../../pages';
import { conversationsService } from '../../conversations';
import { whatsappService } from '../../whatsapp';
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

    async sendReply(page: PlatformPage, senderId: string, text: string): Promise<void> {
        if (!page.platformAccountId) {
            throw new Error('Page has no WhatsApp phone number ID');
        }
        await whatsappService.sendTextMessage(
            page.platformAccountId,
            senderId,
            text,
            page.accessToken,
        );
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
