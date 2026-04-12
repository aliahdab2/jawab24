import { pagesService } from '../../pages';
import { instagramService } from '../../instagram';
import { messagesService } from '../../messages';
import { fbAxios, GRAPH_API_BASE } from '../../../lib/fbAxios';
import { mapToPlatformPage, storeIncomingMessage as storeMessage, markAsReplied as sharedMarkAsReplied, fetchNameFromConversationsApi } from './shared';
import type { MessagePlatformAdapter, PlatformPage, StoredMessage } from '../../../interfaces';

/**
 * Instagram Platform Adapter
 *
 * Implements platform-specific behavior for Instagram DMs.
 */
export class InstagramMessageAdapter implements MessagePlatformAdapter {
    readonly platform = 'instagram' as const;
    readonly maxReplyLength = 1000;

    async getPage(instagramAccountId: string): Promise<PlatformPage | null> {
        const page = await pagesService.getPageByInstagramId(instagramAccountId);
        if (!page) return null;
        return mapToPlatformPage(page, {
            autoReplyEnabled: page.instagramAutoReplyEnabled ?? true,
            platformAccountId: page.instagramAccountId ?? undefined,
        });
    }

    async fetchSenderName(senderId: string, accessToken: string, pageId?: string, platformPageId?: string): Promise<string | undefined> {
        // 1. Check DB first: reuse name from a previous message
        if (pageId) {
            const cached = await messagesService.getSenderNameBySenderId(pageId, senderId);
            if (cached) return cached;
        }

        // 2. Call Instagram Graph API to get sender profile
        try {
            const res = await fbAxios.get(`${GRAPH_API_BASE}/${senderId}`, {
                params: { fields: 'name,username', access_token: accessToken },
            });
            const name = res.data.username || res.data.name;
            if (name) return name;
        } catch {
            // fall through to conversations API fallback
        }

        // 3. Fallback: Conversations API — returns participant names even when direct lookup is restricted
        if (platformPageId) {
            try {
                return await fetchNameFromConversationsApi(platformPageId, senderId, accessToken, 'instagram');
            } catch {
                // Both approaches failed — return undefined
            }
        }

        return undefined;
    }

    async storeIncomingMessage(
        pageId: string,
        instagramMessageId: string,
        senderId: string,
        text: string,
        senderName?: string,
    ): Promise<{ message: StoredMessage; isNew: boolean }> {
        return storeMessage(pageId, instagramMessageId, senderId, text, senderName, 'instagram');
    }

    getInternalMessageId(instagramMessageId: string): string {
        return instagramMessageId;
    }

    async sendTypingIndicator(page: PlatformPage, senderId: string): Promise<void> {
        if (!page.platformAccountId) return;
        await instagramService.sendTypingIndicator(page.platformAccountId, senderId, page.accessToken);
    }

    async sendReply(page: PlatformPage, senderId: string, text: string): Promise<void> {
        if (!page.platformAccountId) {
            throw new Error('Page has no Instagram account ID');
        }
        await instagramService.sendDirectMessage(
            page.platformAccountId,
            senderId,
            text,
            page.accessToken,
        );
    }

    async sendAwayMessage(page: PlatformPage, senderId: string, text: string): Promise<void> {
        if (!page.platformAccountId) return;
        try {
            await instagramService.sendDirectMessage(
                page.platformAccountId,
                senderId,
                text,
                page.accessToken,
            );
        } catch {
            // Instagram may not allow sending to this user
        }
    }

    markAsReplied = sharedMarkAsReplied;
}

export const instagramMessageAdapter = new InstagramMessageAdapter();
