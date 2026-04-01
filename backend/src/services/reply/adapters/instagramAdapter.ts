import axios from 'axios';
import { pagesService } from '../../pages';
import { instagramService } from '../../instagram';
import { messagesService } from '../../messages';
import { db } from '../../../db';
import { messages } from '../../../db/schema';
import { config } from '../../../config';
import { eq, or } from 'drizzle-orm';
import type { MessagePlatformAdapter, PlatformPage, StoredMessage } from '../../../interfaces';

const INSTAGRAM_GRAPH_API = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

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

    async fetchSenderName(senderId: string, accessToken: string, pageId?: string): Promise<string | undefined> {
        // 1. Check DB first: reuse name from a previous message
        if (pageId) {
            const cached = await messagesService.getSenderNameBySenderId(pageId, senderId);
            if (cached) return cached;
        }

        // 2. Call Instagram Graph API to get sender profile
        try {
            const res = await axios.get(`${INSTAGRAM_GRAPH_API}/${senderId}`, {
                params: { fields: 'name,username', access_token: accessToken },
            });
            return res.data.username || res.data.name;
        } catch {
            return undefined;
        }
    }

    async storeIncomingMessage(
        pageId: string,
        instagramMessageId: string,
        senderId: string,
        text: string,
        senderName?: string,
    ): Promise<{ message: StoredMessage; isNew: boolean }> {
        const facebookMessageId = `ig_${instagramMessageId}`;

        // Check if message already exists (by instagramMessageId or facebookMessageId)
        // The nonTextHandler pre-creates records by facebookMessageId before the adapter runs
        const existingRows = await db
            .select()
            .from(messages)
            .where(or(
                eq(messages.instagramMessageId, instagramMessageId),
                eq(messages.facebookMessageId, facebookMessageId),
            ));

        if (existingRows[0]) {
            // Backfill instagramMessageId if missing (pre-created by nonTextHandler)
            const updates: Record<string, unknown> = {};
            if (!existingRows[0].instagramMessageId) updates.instagramMessageId = instagramMessageId;
            if (senderName && !existingRows[0].senderName) updates.senderName = senderName;
            if (Object.keys(updates).length > 0) {
                await db.update(messages).set(updates).where(eq(messages.id, existingRows[0].id));
            }
            return {
                message: { id: existingRows[0].id, replied: existingRows[0].replied ?? false, needsAttention: existingRows[0].needsAttention ?? false },
                isNew: false,
            };
        }
        const [created] = await db
            .insert(messages)
            .values({
                pageId,
                facebookMessageId,
                instagramMessageId,
                platform: 'instagram',
                senderId,
                senderName,
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
