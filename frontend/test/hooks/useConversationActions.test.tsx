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
    platformMessageId: `msg-${Math.random().toString(36).slice(2, 8)}`,
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
        // Toast always shows a stable translated message — never the raw error.
        // The t('replyFailed') mock resolves to the English value from messages.json.
        expect(toast.error).toHaveBeenCalledWith('Failed to send reply');
      });

      // selectedConversation should NOT be modified on error
      expect(result.current.selectedConversation?.messages).toHaveLength(1);
    });

    it('passes a stable clientMessageId on the reply call (idempotency key)', async () => {
      const incomingMsg = makeMessage({ id: 'msg-1' });
      const outgoingMsg = makeMessage({ id: 'msg-reply', direction: 'outgoing' });
      mockReply.mockResolvedValue({ data: outgoingMsg });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      act(() => { result.current.setSelectedConversation(makeConversation([incomingMsg])); });
      act(() => { result.current.handleReply('msg-1', 'Hi'); });

      await waitFor(() => {
        expect(mockReply).toHaveBeenCalled();
      });
      // Signature: reply(messageId, replyText, clientMessageId)
      const [messageId, text, clientMessageId] = mockReply.mock.calls[0];
      expect(messageId).toBe('msg-1');
      expect(text).toBe('Hi');
      expect(typeof clientMessageId).toBe('string');
      expect((clientMessageId as string).length).toBeGreaterThan(0);
    });

    it('retries an axios network error using the SAME clientMessageId across attempts', async () => {
      // The whole point of Phase 1: when the network drops mid-flight, the retry must reuse
      // the previous attempt's idempotency key so the backend dedupes if the prior call
      // actually reached FB. A different key per attempt would cause duplicate sends.
      const axios = (await import('axios')).default;
      const networkErr = new axios.AxiosError('Network Error', undefined, { url: '/x', headers: {} as never });
      // axios.isAxiosError checks the prototype chain; AxiosError instances pass.
      const incomingMsg = makeMessage({ id: 'msg-1' });
      const outgoingMsg = makeMessage({ id: 'msg-reply', direction: 'outgoing' });

      mockReply
        .mockRejectedValueOnce(networkErr)
        .mockRejectedValueOnce(networkErr)
        .mockResolvedValueOnce({ data: outgoingMsg });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      act(() => { result.current.setSelectedConversation(makeConversation([incomingMsg])); });
      act(() => { result.current.handleReply('msg-1', 'Hi'); });

      await waitFor(() => {
        expect(mockReply).toHaveBeenCalledTimes(3);
      }, { timeout: 5000 });

      const keys = mockReply.mock.calls.map((c) => c[2]);
      expect(keys[0]).toBeDefined();
      expect(keys[0]).toBe(keys[1]);
      expect(keys[1]).toBe(keys[2]);

      // Eventually the optimistic append happens once the third attempt resolves.
      await waitFor(() => {
        expect(result.current.selectedConversation?.messages).toHaveLength(2);
      });
    });

    it('does NOT retry on non-axios errors — surfaces immediately so the UI can react', async () => {
      // A plain Error (or a backend 4xx) must not trigger the transport-failure retry path,
      // otherwise the user waits ~3 seconds for an error that was never going to recover.
      const incomingMsg = makeMessage({ id: 'msg-1' });
      mockReply.mockRejectedValue(new Error('boom'));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      act(() => { result.current.setSelectedConversation(makeConversation([incomingMsg])); });
      act(() => { result.current.handleReply('msg-1', 'Hi'); });

      await waitFor(() => {
        expect(mockReply).toHaveBeenCalledTimes(1);
      });
    });

    describe('error toast — distinct copy per failure cause', () => {
      // The merchant complaint that motivated this test: a generic "failed to send" toast
      // hid the difference between Facebook policy errors (window expired, page disconnected)
      // and real network problems. Each backend code must surface its own copy so the agent
      // knows whether to retry, reconnect, or wait for the customer to message first.

      type Case = { name: string; code: string; status: number; expected: string };
      const cases: Case[] = [
        { name: '24h window expired', code: 'DM_WINDOW_EXPIRED', status: 409, expected: 'The 24-hour reply window has closed. You can only reply after the customer messages you again.' },
        { name: 'customer unavailable', code: 'DM_CUSTOMER_UNAVAILABLE', status: 409, expected: "This customer's account is no longer available on Facebook." },
        { name: 'page disconnected', code: 'PAGE_DISCONNECTED', status: 409, expected: 'This page is disconnected. Please reconnect from Settings.' },
        { name: 'transient platform error', code: 'DM_TRANSIENT', status: 503, expected: 'Facebook is busy right now. Please try again in a moment.' },
        { name: 'platform auth revoked', code: 'DM_PLATFORM_AUTH', status: 409, expected: 'Facebook revoked access. Please reconnect this page from Settings.' },
      ];

      for (const { name, code, status, expected } of cases) {
        it(`maps ${name} (${code}) to its specific copy`, async () => {
          const { toast } = await import('sonner');
          const axios = (await import('axios')).default;
          const err = new axios.AxiosError(name, undefined, { url: '/x', headers: {} as never });
          // axios uses `response.data.code` to carry the structured backend error shape.
          (err as unknown as { response: unknown }).response = { status, data: { code, error: name } };

          const incomingMsg = makeMessage({ id: 'msg-1' });
          mockReply.mockRejectedValue(err);

          const { wrapper } = createWrapper();
          const { result } = renderHook(() => useConversationActions(), { wrapper });

          act(() => { result.current.setSelectedConversation(makeConversation([incomingMsg])); });
          act(() => { result.current.handleReply('msg-1', 'Hi'); });

          await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith(expected);
          });
        });
      }

      it('axios timeout (no backend code) → timeout-specific copy', async () => {
        const { toast } = await import('sonner');
        const axios = (await import('axios')).default;
        // ECONNABORTED is what axios emits on a per-request timeout.
        const err = new axios.AxiosError('timeout of 60000ms exceeded', 'ECONNABORTED', { url: '/x', headers: {} as never });

        const incomingMsg = makeMessage({ id: 'msg-1' });
        mockReply.mockRejectedValue(err);

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useConversationActions(), { wrapper });

        act(() => { result.current.setSelectedConversation(makeConversation([incomingMsg])); });
        act(() => { result.current.handleReply('msg-1', 'Hi'); });

        await waitFor(() => {
          expect(toast.error).toHaveBeenCalledWith('The request took too long. Check your connection and try again.');
        }, { timeout: 5000 });
      });

      it('axios network error (no response) → network-specific copy', async () => {
        const { toast } = await import('sonner');
        const axios = (await import('axios')).default;
        const err = new axios.AxiosError('Network Error', undefined, { url: '/x', headers: {} as never });
        // Leave response undefined so isNetworkError() returns true.

        const incomingMsg = makeMessage({ id: 'msg-1' });
        mockReply.mockRejectedValue(err);

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useConversationActions(), { wrapper });

        act(() => { result.current.setSelectedConversation(makeConversation([incomingMsg])); });
        act(() => { result.current.handleReply('msg-1', 'Hi'); });

        await waitFor(() => {
          expect(toast.error).toHaveBeenCalledWith('Connection problem. Check your internet and try again.');
        }, { timeout: 5000 });
      });

      it('unknown backend code falls back to the generic copy (no missing-key surprises)', async () => {
        const { toast } = await import('sonner');
        const axios = (await import('axios')).default;
        const err = new axios.AxiosError('something new', undefined, { url: '/x', headers: {} as never });
        (err as unknown as { response: unknown }).response = { status: 500, data: { code: 'DM_UNKNOWN' } };

        const incomingMsg = makeMessage({ id: 'msg-1' });
        mockReply.mockRejectedValue(err);

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useConversationActions(), { wrapper });

        act(() => { result.current.setSelectedConversation(makeConversation([incomingMsg])); });
        act(() => { result.current.handleReply('msg-1', 'Hi'); });

        await waitFor(() => {
          expect(toast.error).toHaveBeenCalledWith('Failed to send reply');
        });
      });
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
