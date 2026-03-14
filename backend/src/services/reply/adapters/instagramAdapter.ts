import { pagesService } from '../../pages';
import { instagramService } from '../../instagram';
import { messagesService } from '../../messages';
import { db } from '../../../db';
import { messages } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import type { MessagePlatformAdapter, PlatformPage, StoredMessage } from '../../../interfaces';

/**
 * Instagram Platform Adapter
 *
 * Implements platform-specific behavior for Instagram DMs.
 */
export class InstagramMessageAdapter implements MessagePlatformAdapter {
    readonly platform = 'instagram' as const;

    async getPage(instagramAccountId: string): Promise<PlatformPage | null> {
        const page = await pagesService.getPageByInstagramId(instagramAccountId);
        if (!page) return null;
        return {
            id: page.id,
            userId: page.userId,
            workspaceId: page.workspaceId,
            name: page.name,
            accessToken: page.accessToken,
            knowledgeBase: page.knowledgeBase,
            kbActiveVersion: page.kbActiveVersion ?? null,
            autoReplyEnabled: page.instagramAutoReplyEnabled ?? true,
            platformAccountId: page.instagramAccountId ?? undefined,
            ecommerceStoreId: page.ecommerceStoreId,
            businessProfile: page.businessProfile as Record<string, unknown> | null,
        };
    }

    async fetchSenderName(_senderId: string, _accessToken: string, _pageId?: string, _platformPageId?: string): Promise<string | undefined> {
        // Instagram doesn't support fetching sender profile via API
        return undefined;
    }

    async storeIncomingMessage(
        pageId: string,
        instagramMessageId: string,
        senderId: string,
        text: string,
        _senderName?: string,
    ): Promise<{ message: StoredMessage; isNew: boolean }> {
        // Check if message already exists by Instagram message ID
        const existingRows = await db
            .select()
            .from(messages)
            .where(eq(messages.instagramMessageId, instagramMessageId));

        if (existingRows[0]) {
            return {
                message: { id: existingRows[0].id, replied: existingRows[0].replied ?? false, needsAttention: existingRows[0].needsAttention ?? false },
                isNew: false,
            };
        }

        // Create with Instagram-specific fields
        const facebookMessageId = `ig_${instagramMessageId}`;
        const [created] = await db
            .insert(messages)
            .values({
                pageId,
                facebookMessageId,
                instagramMessageId,
                platform: 'instagram',
                senderId,
                message: text,
                direction: 'incoming',
                createdTime: new Date(),
            })
            .returning();

        return {
            message: { id: created.id, replied: created.replied ?? false },
            isNew: true,
        };
    }

    getInternalMessageId(instagramMessageId: string): string {
        return `ig_${instagramMessageId}`;
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

export const instagramMessageAdapter = new InstagramMessageAdapter();
