import { pagesService } from '../../pages';
import { instagramService } from '../../instagram';
import { conversationsService } from '../../conversations';
import { fbAxios, GRAPH_API_BASE } from '../../../lib/fbAxios';
import {
    resolveInstagramCredential,
    instagramCredentialOf,
    instagramMessagesEndpoint,
} from '../../instagramCredential';
import { mapToPlatformPage, storeIncomingMessage as storeMessage, markAsReplied as sharedMarkAsReplied, fetchNameFromConversationsApi } from './shared';
import { sendMetaProductCards } from '../../metaMessaging';
import type { MessagePlatformAdapter, PlatformPage, StoredMessage } from '../../../interfaces';
import { renderReplyForChannel, type ProductCard } from '@jawab24/shared';

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
        const credential = resolveInstagramCredential(page);
        // Same contract as the WhatsApp adapter: `accessToken` carries the
        // credential THIS platform sends with, which for an Instagram Login page
        // is the Instagram User token rather than the (empty) Facebook page token.
        return mapToPlatformPage({ ...page, accessToken: credential.accessToken }, {
            autoReplyEnabled: page.instagramAutoReplyEnabled ?? true,
            platformAccountId: page.instagramAccountId ?? undefined,
            instagramCredential: credential,
        });
    }

    async fetchSenderName(senderId: string, accessToken: string, pageId?: string, platformPageId?: string, baseUrl: string = GRAPH_API_BASE): Promise<string | undefined> {
        // 1. Canonical source: conversations table
        if (pageId) {
            const canonical = await conversationsService.getSenderName(pageId, senderId);
            if (canonical) return canonical;
        }

        // 2. Call Instagram Graph API to get sender profile
        try {
            const res = await fbAxios.get(`${baseUrl}/${senderId}`, {
                params: { fields: 'name,username', access_token: accessToken },
            });
            const name = res.data.username || res.data.name;
            if (name) {
                if (pageId) conversationsService.setSenderName(pageId, senderId, name).catch(() => {});
                return name;
            }
        } catch {
            // fall through to conversations API fallback
        }

        // 3. Fallback: Graph Conversations API — returns participant names even when direct lookup is restricted
        if (platformPageId) {
            try {
                const name = await fetchNameFromConversationsApi(platformPageId, senderId, accessToken, 'instagram', baseUrl);
                if (name && pageId) conversationsService.setSenderName(pageId, senderId, name).catch(() => {});
                return name;
            } catch {
                // Both approaches failed — return undefined
            }
        }

        return undefined;
    }

    async storeIncomingMessage(
        pageId: string,
        workspaceId: string,
        instagramMessageId: string,
        senderId: string,
        text: string,
        senderName?: string,
    ): Promise<{ message: StoredMessage; isNew: boolean }> {
        return storeMessage(pageId, workspaceId, instagramMessageId, senderId, text, senderName, 'instagram');
    }

    getInternalMessageId(instagramMessageId: string): string {
        return instagramMessageId;
    }

    async sendTypingIndicator(page: PlatformPage, senderId: string): Promise<void> {
        if (!page.platformAccountId) return;
        await instagramService.sendTypingIndicator(page.platformAccountId, senderId, instagramCredentialOf(page));
    }

    async sendTypingOff(page: PlatformPage, senderId: string): Promise<void> {
        if (!page.platformAccountId) return;
        await instagramService.sendTypingOff(page.platformAccountId, senderId, instagramCredentialOf(page));
    }

    renderReply(text: string): string {
        return renderReplyForChannel(text, 'plain');
    }

    async sendReply(page: PlatformPage, senderId: string, text: string): Promise<string | undefined> {
        if (!page.platformAccountId) {
            throw new Error('Page has no Instagram account ID');
        }
        await instagramService.sendDirectMessage(
            page.platformAccountId,
            senderId,
            text,
            instagramCredentialOf(page),
        );
        // See facebookAdapter.sendReply — no Coexistence equivalent on Instagram.
        return undefined;
    }

    async sendProductCards(page: PlatformPage, senderId: string, cards: ProductCard[]): Promise<void> {
        const cred = instagramCredentialOf(page);
        await sendMetaProductCards(
            cred.accessToken, senderId, cards, undefined,
            instagramMessagesEndpoint(cred, page.platformAccountId ?? ''),
        );
    }

    async sendAwayMessage(page: PlatformPage, senderId: string, text: string): Promise<void> {
        if (!page.platformAccountId) return;
        try {
            await instagramService.sendDirectMessage(
                page.platformAccountId,
                senderId,
                text,
                instagramCredentialOf(page),
            );
        } catch {
            // Instagram may not allow sending to this user
        }
    }

    markAsReplied = sharedMarkAsReplied;
}

export const instagramMessageAdapter = new InstagramMessageAdapter();
