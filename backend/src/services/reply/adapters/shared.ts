import { fbAxios, GRAPH_API_BASE } from '../../../lib/fbAxios';
import { messagesService } from '../../messages';
import type { PlatformPage, StoredMessage } from '../../../interfaces';

type ConversationParticipant = { id: string; name?: string; username?: string };
type ConversationEntry = { participants?: { data?: ConversationParticipant[] } };

/**
 * Resolve a sender's display name via the Conversations API.
 * Works for both Facebook (no platform param) and Instagram (platform: 'instagram').
 * Used as a fallback when the direct profile API is restricted.
 */
export async function fetchNameFromConversationsApi(
    platformPageId: string,
    senderId: string,
    accessToken: string,
    platform?: 'instagram',
): Promise<string | undefined> {
    const res = await fbAxios.get(`${GRAPH_API_BASE}/${platformPageId}/conversations`, {
        params: {
            user_id: senderId,
            fields: 'participants',
            access_token: accessToken,
            ...(platform ? { platform } : {}),
        },
    });
    const conversations = res.data?.data as ConversationEntry[] | undefined;
    if (!conversations?.length) return undefined;
    const participants = conversations[0].participants?.data ?? [];
    const sender = participants.find(p => p.id === senderId);
    return sender?.username || sender?.name;
}

/**
 * Shared adapter helpers — default implementations for methods that are
 * identical across Facebook, Instagram, and WhatsApp adapters.
 */

/** Map a DB page row to PlatformPage. Adapters provide platform-specific overrides. */
export function mapToPlatformPage(
    page: {
        id: string;
        userId: string | null;
        workspaceId: string | null;
        name: string | null;
        accessToken: string;
        knowledgeBase: string | null;
        kbActiveVersion: number | null;
        ecommerceStoreId: string | null;
        businessProfile: unknown;
        replyMode?: string | null;
    },
    overrides: {
        autoReplyEnabled: boolean;
        autoReplyDisabledReason?: string | null;
        platformAccountId?: string;
    },
): PlatformPage {
    return {
        id: page.id,
        userId: page.userId,
        workspaceId: page.workspaceId,
        name: page.name,
        accessToken: page.accessToken,
        knowledgeBase: page.knowledgeBase,
        kbActiveVersion: page.kbActiveVersion ?? null,
        autoReplyEnabled: overrides.autoReplyEnabled,
        autoReplyDisabledReason: overrides.autoReplyDisabledReason ?? null,
        platformAccountId: overrides.platformAccountId,
        ecommerceStoreId: page.ecommerceStoreId,
        businessProfile: page.businessProfile as Record<string, unknown> | null,
        replyMode: page.replyMode ?? null,
    };
}

/** Store incoming message via messagesService — used by all adapters. */
export async function storeIncomingMessage(
    pageId: string,
    workspaceId: string,
    platformMessageId: string,
    senderId: string,
    text: string,
    senderName?: string,
    platform?: string,
): Promise<{ message: StoredMessage; isNew: boolean }> {
    const { message, isNew } = await messagesService.findOrCreateFromWebhook(
        pageId, workspaceId, platformMessageId, senderId, text, senderName, undefined, platform,
    );
    return {
        message: {
            id: message.id,
            replied: message.replied,
            needsAttention: message.needsAttention ?? false,
            createdAt: message.createdAt ?? null,
            enrichmentStatus: message.enrichmentStatus ?? null,
        },
        isNew,
    };
}

/** Mark message as replied — identical for all adapters. */
export async function markAsReplied(
    messageId: string,
    replyText: string,
    replyMethod: 'template' | 'ai' | 'manual' | 'post_reply',
    needsAttention?: boolean,
    flagReason?: string,
    aiIntent?: string,
    aiOriginalReply?: string,
): Promise<void> {
    await messagesService.markAsReplied(messageId, replyText, replyMethod, needsAttention, flagReason, aiIntent, undefined, aiOriginalReply);
}
