import { useCallback } from 'react';
import { messagesApi } from '@/lib/api';
import type { Conversation } from '@/components/messages/MessageCard';

export interface LoadConversationInput {
  senderId: string;
  pageId: string;
  senderName?: string | null;
  limit?: number;
}

/**
 * Fetches a conversation by senderId + pageId and returns a Conversation object
 * ready to feed into setSelectedConversation. Used by deep-links (notification taps,
 * dashboard shortcuts) that open the modal without scanning the paginated list.
 *
 * Returns null when the server returns no messages (conversation empty/removed).
 * Throws on network/auth errors — callers handle toasts and Sentry reporting.
 */
export function useLoadConversation() {
  return useCallback(async ({ senderId, pageId, senderName, limit = 50 }: LoadConversationInput): Promise<Conversation | null> => {
    const { data } = await messagesApi.getConversation(senderId, { pageId, limit });
    const msgs = Array.isArray(data) ? data : [];
    if (msgs.length === 0) return null;

    const sorted = [...msgs].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return {
      senderId,
      senderName: senderName ?? sorted[0]?.senderName ?? null,
      messages: sorted,
      lastMessage: sorted[sorted.length - 1],
      needsHumanAttention: sorted.some(m => m.needsAttention && !m.replied),
    };
  }, []);
}
