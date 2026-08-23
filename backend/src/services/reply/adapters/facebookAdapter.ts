import { pagesService } from '../../pages';
import { facebookService } from '../../facebook';
import { conversationsService } from '../../conversations';
import { sendMetaProductCards } from '../../metaMessaging';
import { redis } from '../../../lib/redis';
import { mapToPlatformPage, storeIncomingMessage as storeMessage, markAsReplied as sharedMarkAsReplied } from './shared';
import type { MessagePlatformAdapter, PlatformPage, StoredMessage } from '../../../interfaces';
import { renderReplyForChannel, type ProductCard } from '@jawab24/shared';

const SENDER_NAME_CACHE_TTL = 86400; // 24 hours
const senderNameCacheKey = (senderId: string) => `sender_name:${senderId}`;

/**
 * Facebook Messenger Platform Adapter
 *
 * Implements platform-specific behavior for Facebook DMs.
 */
export class FacebookMessageAdapter implements MessagePlatformAdapter {
    readonly platform = 'facebook' as const;
    readonly maxReplyLength = 2000;

    async getPage(facebookPageId: string): Promise<PlatformPage | null> {
        const page = await pagesService.getPageByFacebookId(facebookPageId);
        if (!page) return null;
        return mapToPlatformPage(page, {
            autoReplyEnabled: page.autoReplyEnabled ?? true,
            platformAccountId: page.facebookPageId ?? undefined,
        });
    }

    async fetchSenderName(senderId: string, accessToken: string, pageId?: string, platformPageId?: string): Promise<string | undefined> {
        // 1. Canonical source: conversations table
        if (pageId) {
            const canonical = await conversationsService.getSenderName(pageId, senderId);
            if (canonical) return canonical;
        }

        // 2. Redis cache (avoids Facebook API call for recently-looked-up senders)
        try {
            const redisCached = await redis.get(senderNameCacheKey(senderId));
            if (redisCached) {
                // Keep the canonical store in sync when we learn a name via cache
                if (pageId) conversationsService.setSenderName(pageId, senderId, redisCached).catch(() => {});
                return redisCached;
            }
        } catch {
            // Redis unavailable — fall through
        }

        // 3. Cache miss — call Facebook API (platformPageId enables Conversations API fallback)
        try {
            const profile = await facebookService.getSenderProfile(senderId, accessToken, platformPageId);
            const name = profile?.name;
            if (name) {
                redis.set(senderNameCacheKey(senderId), name, 'EX', SENDER_NAME_CACHE_TTL).catch(() => {});
                if (pageId) conversationsService.setSenderName(pageId, senderId, name).catch(() => {});
            }
            return name;
        } catch {
            return undefined;
        }
    }

    async storeIncomingMessage(
        pageId: string,
        workspaceId: string,
        messageId: string,
        senderId: string,
        text: string,
        senderName?: string,
    ): Promise<{ message: StoredMessage; isNew: boolean }> {
        return storeMessage(pageId, workspaceId, messageId, senderId, text, senderName);
    }

    getInternalMessageId(messageId: string): string {
        return messageId;
    }

    async sendTypingIndicator(page: PlatformPage, senderId: string): Promise<void> {
        await facebookService.sendTypingIndicator(page.accessToken, senderId);
    }

    async sendTypingOff(page: PlatformPage, senderId: string): Promise<void> {
        await facebookService.sendTypingOff(page.accessToken, senderId);
    }

    renderReply(text: string): string {
        return renderReplyForChannel(text, 'plain');
    }

    async sendReply(page: PlatformPage, senderId: string, text: string): Promise<string | undefined> {
        await facebookService.sendPrivateMessage(page.accessToken, senderId, text);
        // No id surfaced: Messenger has no Coexistence equivalent (a Page is not
        // also running in a consumer app), so nothing needs to recognise our own
        // sends. Returning undefined keeps the caller on the synthetic id.
        return undefined;
    }

    async sendProductCards(page: PlatformPage, senderId: string, cards: ProductCard[]): Promise<void> {
        await sendMetaProductCards(page.accessToken, senderId, cards);
    }

    async sendAwayMessage(page: PlatformPage, senderId: string, text: string): Promise<void> {
        await facebookService.sendPrivateMessage(page.accessToken, senderId, text);
    }

    markAsReplied = sharedMarkAsReplied;
}

export const facebookMessageAdapter = new FacebookMessageAdapter();
