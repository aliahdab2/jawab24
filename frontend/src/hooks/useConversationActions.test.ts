import '@testing-library/jest-dom';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Must mock before importing the hook
const mockResolveConversation = vi.fn();
const mockUnresolveConversation = vi.fn();

vi.mock('@/lib/api', () => ({
  messagesApi: {
    resolveConversation: (...args: unknown[]) => mockResolveConversation(...args),
    unresolveConversation: (...args: unknown[]) => mockUnresolveConversation(...args),
    pauseConversation: vi.fn(),
    resumeConversation: vi.fn(),
    getPauseStatus: vi.fn(),
    reply: vi.fn(),
  },
}));

import { useConversationActions } from './useConversationActions';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, invalidateSpy };
}

describe('useConversationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleResolve', () => {
    it('invalidates messages-stats after resolve', async () => {
      mockResolveConversation.mockResolvedValue({ data: { success: true, resolved: 1 } });
      const { wrapper, invalidateSpy } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      await act(async () => {
        await result.current.handleResolve('sender1', 'page1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages-stats'] });
    });

    // Regression: invalidateShared was missing dashboard-needs-action-comments,
    // so comments stayed in the attention banner after a message was resolved
    it('invalidates dashboard-needs-action-comments after resolve', async () => {
      mockResolveConversation.mockResolvedValue({ data: { success: true, resolved: 1 } });
      const { wrapper, invalidateSpy } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      await act(async () => {
        await result.current.handleResolve('sender1', 'page1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard-needs-action-comments'] });
    });

    it('invalidates extra keys passed in options after resolve', async () => {
      mockResolveConversation.mockResolvedValue({ data: { success: true, resolved: 1 } });
      const { wrapper, invalidateSpy } = createWrapper();
      const { result } = renderHook(
        () => useConversationActions({ extraInvalidateKeys: [['dashboard-recent-messages']] }),
        { wrapper },
      );

      await act(async () => {
        await result.current.handleResolve('sender1', 'page1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard-recent-messages'] });
    });

    it('calls resolveConversation API with correct args', async () => {
      mockResolveConversation.mockResolvedValue({ data: { success: true, resolved: 1 } });
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      await act(async () => {
        await result.current.handleResolve('sender-abc', 'page-xyz');
      });

      expect(mockResolveConversation).toHaveBeenCalledWith('sender-abc', 'page-xyz');
    });
  });

  describe('handleUnresolve', () => {
    it('invalidates messages-stats and dashboard-needs-action-comments after unresolve', async () => {
      mockUnresolveConversation.mockResolvedValue({ data: { success: true } });
      const { wrapper, invalidateSpy } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      await act(async () => {
        await result.current.handleUnresolve('sender1', 'page1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages-stats'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard-needs-action-comments'] });
    });
  });
});
