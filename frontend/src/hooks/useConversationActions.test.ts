import '@testing-library/jest-dom';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Must mock before importing the hook
const mockResolveConversation = vi.fn();
const mockUnresolveConversation = vi.fn();
const mockReply = vi.fn();

vi.mock('@/lib/api', () => ({
  messagesApi: {
    resolveConversation: (...args: unknown[]) => mockResolveConversation(...args),
    unresolveConversation: (...args: unknown[]) => mockUnresolveConversation(...args),
    pauseConversation: vi.fn(),
    resumeConversation: vi.fn(),
    getPauseStatus: vi.fn(),
    reply: (...args: unknown[]) => mockReply(...args),
  },
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => mockToastError(...args),
    warning: vi.fn(),
  },
}));

const mockCaptureError = vi.fn();
vi.mock('@/lib/sentryHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sentryHelpers')>();
  return {
    ...actual,
    captureError: (...args: unknown[]) => mockCaptureError(...args),
  };
});

import { useConversationActions } from './useConversationActions';
import { AxiosError, AxiosHeaders } from 'axios';

function makeAxios500(code?: string): AxiosError {
  const err = new AxiosError('Request failed with status code 500', '500');
  err.response = {
    status: 500,
    statusText: 'Internal Server Error',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: code ? { error: true, code, message: 'upstream' } : { error: true },
  };
  return err;
}

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

  describe('handleReply onError', () => {
    // Regression: the toast used to show `error.message` ("Request failed with status code 500"),
    // leaking axios internals to the user. It now always shows the translated replyFailed key.
    it('shows a translated toast (never the raw axios message) on 500', async () => {
      mockReply.mockRejectedValue(makeAxios500());
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      await act(async () => {
        result.current.handleReply('msg-1', 'hi');
        // Allow the mutation to settle
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockToastError).toHaveBeenCalledTimes(1);
      const toastArg = mockToastError.mock.calls[0][0] as string;
      expect(toastArg).not.toContain('500');
      expect(toastArg).not.toContain('Request failed');
    });

    it('captures unexpected errors to Sentry (so silent 500s stop being invisible)', async () => {
      mockReply.mockRejectedValue(makeAxios500());
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      await act(async () => {
        result.current.handleReply('msg-1', 'hi');
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockCaptureError).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['DM_WINDOW_EXPIRED'],
      ['DM_CUSTOMER_UNAVAILABLE'],
      ['DM_TRANSIENT'],
    ])('does NOT capture expected platform condition %s to Sentry', async (code) => {
      mockReply.mockRejectedValue(makeAxios500(code));
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useConversationActions(), { wrapper });

      await act(async () => {
        result.current.handleReply('msg-1', 'hi');
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockToastError).toHaveBeenCalledTimes(1);
      expect(mockCaptureError).not.toHaveBeenCalled();
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
