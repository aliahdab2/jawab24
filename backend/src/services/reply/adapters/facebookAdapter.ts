import { pagesService } from '../../pages';
import { facebookService } from '../../facebook';
import { messagesService } from '../../messages';
import { redis } from '../../../lib/redis';
import type { MessagePlatformAdapter, PlatformPage, StoredMessage } from '../../../interfaces';

const SENDER_NAME_CACHE_TTL = 86400; // 24 hours
const senderNameCacheKey = (senderId: string) => `sender_name:${senderId}`;

/**
 * Facebook Messenger Platform Adapter
 *
 * Implements platform-specific behavior for Facebook DMs.
 */
export class FacebookMessageAdapter implements MessagePlatformAdapter {
    readonly platform = 'facebook' as const;

    async getPage(facebookPageId: string): Promise<PlatformPage | null> {
        const page = await pagesService.getPageByFacebookId(facebookPageId);
        if (!page) return null;
        return {
            id: page.id,
            userId: page.userId,
            workspaceId: page.workspaceId,
            name: page.name,
            accessToken: page.accessToken,
            knowledgeBase: page.knowledgeBase,
            kbActiveVersion: page.kbActiveVersion ?? null,
            autoReplyEnabled: page.autoReplyEnabled ?? true,
            ecommerceStoreId: page.ecommerceStoreId,
            businessProfile: page.businessProfile as Record<string, unknown> | null,
        };
    }

    async fetchSenderName(senderId: string, accessToken: string, pageId?: string): Promise<string | undefined> {
        // 1. Check DB first: reuse name from a previous message with this sender
        if (pageId) {
            const cached = await messagesService.getSenderNameBySenderId(pageId, senderId);
            if (cached) return cached;
        }

        // 2. Check Redis cache (avoids Facebook API call for recently-looked-up senders)
        try {
            const redisCached = await redis.get(senderNameCacheKey(senderId));
            if (redisCached) return redisCached;
        } catch {
            // Redis unavailable — fall through
        }

        // 3. Cache miss — call Facebook API (pageId enables Conversations API fallback)
        try {
            const profile = await facebookService.getSenderProfile(senderId, accessToken, pageId);
            const name = profile?.name;
            if (name) {
                redis.set(senderNameCacheKey(senderId), name, 'EX', SENDER_NAME_CACHE_TTL).catch(() => {});
            }
            return name;
        } catch {
            return undefined;
        }
    }

    async storeIncomingMessage(
        pageId: string,
        messageId: string,
        senderId: string,
        text: string,
        senderName?: string,
    ): Promise<{ message: StoredMessage; isNew: boolean }> {
        const { message, isNew } = await messagesService.findOrCreateFromWebhook(
            pageId, messageId, senderId, text, senderName,
        );
        return {
            message: { id: message.id, replied: message.replied, needsAttention: message.needsAttention ?? false },
            isNew,
        };
    }

    getInternalMessageId(messageId: string): string {
        return messageId;
    }

    async sendReply(page: PlatformPage, senderId: string, text: string): Promise<void> {
        try { await facebookService.sendTypingIndicator(page.accessToken, senderId); } catch { /* cosmetic */ }
        await facebookService.sendPrivateMessage(page.accessToken, senderId, text);
    }

    async sendAwayMessage(page: PlatformPage, senderId: string, text: string): Promise<void> {
        try { await facebookService.sendTypingIndicator(page.accessToken, senderId); } catch { /* cosmetic */ }
        await facebookService.sendPrivateMessage(page.accessToken, senderId, text);
    }

    async markAsReplied(
        messageId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual',
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
        aiOriginalReply?: string,
    ): Promise<void> {
        await messagesService.markAsReplied(messageId, replyText, replyMethod, needsAttention, flagReason, aiIntent, undefined, aiOriginalReply);
    }
}

export const facebookMessageAdapter = new FacebookMessageAdapter();
