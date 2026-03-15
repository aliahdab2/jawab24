import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Message } from '@/lib/api';
import type { Conversation } from '@/components/messages/MessageCard';

// Mock API
const mockReply = vi.fn();
const mockResolve = vi.fn();
const mockUnresolve = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockGetPauseStatus = vi.fn();

vi.mock('@/lib/api', () => ({
  messagesApi: {
    reply: (...args: unknown[]) => mockReply(...args),
    resolveConversation: (...args: unknown[]) => mockResolve(...args),
    unresolveConversation: (...args: unknown[]) => mockUnresolve(...args),
    pauseConversation: (...args: unknown[]) => mockPause(...args),
    resumeConversation: (...args: unknown[]) => mockResume(...args),
    getPauseStatus: (...args: unknown[]) => mockGetPauseStatus(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

// Import after mocks
import { useConversationActions } from '@/hooks/useConversationActions';

const now = new Date().toISOString();

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    pageId: 'page-1',
    facebookMessageId: `fb-${Math.random().toString(36).slice(2, 8)}`,
    senderId: 'sender-1',
    senderName: 'Ali',
    message: 'Hello',
    direction: 'incoming',
    replied: false,
    replyText: null,
    replyMethod: null,
    createdTime: now,
    repliedAt: null,
    createdAt: now,
    ...overrides,
  };
}

function makeConversation(msgs: Message[], overrides: Partial<Conversation> = {}): Conversation {
  return {
    senderId: 'sender-1',
    senderName: 'Ali',
    messages: msgs,
    lastMessage: msgs[msgs.length - 1],
    needsHumanAttention: false,
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

describe('useConversationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPauseStatus.mockResolvedValue({ data: { paused: false, pausedUntil: null, remainingMinutes: null } });
  });

  describe('handleReply', () => {
    it('optimistically adds outgoing message to selectedConversation', async () => {
      const incomingMsg = makeMessage({ id: 'msg-1', message: 'Hi' });
      const outgoingMsg = makeMessage({
        id: 'msg-reply',
        direction: 'outgoing',
        message: 'Hello back!',
        replied: true,
        replyMethod: 'manual',
      });

      mockReply.mockResolvedValue({ data: outgoingMsg });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      // Set the selected conversation
      act(() => {
        result.current.setSelectedConversation(makeConversation([incomingMsg]));
      });

      expect(result.current.selectedConversation?.messages).toHaveLength(1);

      // Send reply
      act(() => {
        result.current.handleReply('msg-1', 'Hello back!');
      });

      await waitFor(() => {
        expect(result.current.selectedConversation?.messages).toHaveLength(2);
      });

      // Verify the outgoing message was appended
      const msgs = result.current.selectedConversation!.messages;
      expect(msgs[1].id).toBe('msg-reply');
      expect(msgs[1].direction).toBe('outgoing');
      expect(result.current.selectedConversation!.lastMessage.id).toBe('msg-reply');
    });

    it('updates the conversation query cache for the modal', async () => {
      const incomingMsg = makeMessage({ id: 'msg-1', pageId: 'page-1', senderId: 'sender-1' });
      const outgoingMsg = makeMessage({
        id: 'msg-reply',
        direction: 'outgoing',
        message: 'Reply!',
        replied: true,
        replyMethod: 'manual',
      });

      mockReply.mockResolvedValue({ data: outgoingMsg });

      const { wrapper, queryClient } = createWrapper();

      // Pre-populate the modal's conversation cache (simulating what MessageDetailModal does)
      queryClient.setQueryData(['conversation', 'sender-1', 'page-1'], [incomingMsg]);

      const { result } = renderHook(() => useConversationActions(), { wrapper });

      // Set selected conversation
      act(() => {
        result.current.setSelectedConversation(makeConversation([incomingMsg]));
      });

      // Send reply
      act(() => {
        result.current.handleReply('msg-1', 'Reply!');
      });

      await waitFor(() => {
        // Verify the query cache was updated with the new message
        const cached = queryClient.getQueryData<Message[]>(['conversation', 'sender-1', 'page-1']);
        expect(cached).toHaveLength(2);
        expect(cached![1].id).toBe('msg-reply');
      });
    });

    it('shows error toast on reply failure', async () => {
      const { toast } = await import('sonner');
      const incomingMsg = makeMessage({ id: 'msg-1' });
      mockReply.mockRejectedValue(new Error('Network error'));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      act(() => {
        result.current.setSelectedConversation(makeConversation([incomingMsg]));
      });

      act(() => {
        result.current.handleReply('msg-1', 'Reply');
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Network error');
      });

      // selectedConversation should NOT be modified on error
      expect(result.current.selectedConversation?.messages).toHaveLength(1);
    });
  });

  describe('handleResolve', () => {
    it('clears selectedConversation on resolve', async () => {
      const incomingMsg = makeMessage({ id: 'msg-1', senderId: 'sender-1' });
      mockResolve.mockResolvedValue({ data: { success: true, resolved: 1 } });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      act(() => {
        result.current.setSelectedConversation(makeConversation([incomingMsg]));
      });
      expect(result.current.selectedConversation).not.toBeNull();

      await act(async () => {
        await result.current.handleResolve('sender-1', 'page-1');
      });

      expect(result.current.selectedConversation).toBeNull();
    });
  });

  describe('handleUnresolve', () => {
    it('calls unresolve API and keeps conversation open', async () => {
      const msg = makeMessage({ id: 'msg-1', resolved: true, replied: true });
      mockUnresolve.mockResolvedValue({ data: { success: true, unresolved: 1 } });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      act(() => {
        result.current.setSelectedConversation(makeConversation([msg]));
      });

      await act(async () => {
        await result.current.handleUnresolve('sender-1', 'page-1');
      });

      // Conversation should remain open (unlike resolve which closes it)
      expect(result.current.selectedConversation).not.toBeNull();
      expect(mockUnresolve).toHaveBeenCalledWith('sender-1', 'page-1');
    });
  });
});
