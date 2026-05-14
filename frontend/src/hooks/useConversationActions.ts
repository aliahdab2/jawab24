import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Message, messagesApi } from '@/lib/api';
import axios from 'axios';
import { isNetworkError, isTimeoutError } from '@/lib/axiosRetry';
import { newClientMessageId } from '@/lib/uuid';
import { useTranslations } from 'next-intl';
import { captureError, getBackendErrorCode } from '@/lib/sentryHelpers';
import type { Conversation } from '@/components/messages';

const REPLY_ERROR_KEYS: Record<string, string> = {
  DM_WINDOW_EXPIRED: 'replyFailedWindowExpired',
  DM_CUSTOMER_UNAVAILABLE: 'replyFailedCustomerUnavailable',
  PAGE_DISCONNECTED: 'replyFailedPageDisconnected',
  DM_TRANSIENT: 'replyFailedTransient',
  DM_PLATFORM_AUTH: 'replyFailedPlatformAuth',
  CONVERSATION_NOT_FOUND: 'replyFailedConversationNotFound',
};

/**
 * Pick the messages-namespace translation key for a manual-reply failure. Backend codes
 * win because they're authoritative (Facebook policy decisions). Otherwise we fall back
 * to inspecting the axios error to distinguish "no internet" from "request hung up".
 * Anything else returns the generic key.
 */
export function replyErrorTranslationKey(backendCode: string | undefined, error: unknown): string {
  if (backendCode && REPLY_ERROR_KEYS[backendCode]) return REPLY_ERROR_KEYS[backendCode];
  if (axios.isAxiosError(error)) {
    if (isTimeoutError(error)) return 'replyFailedTimeout';
    if (isNetworkError(error)) return 'replyFailedNetwork';
  }
  return 'replyFailed';
}

interface UseConversationActionsOptions {
  /** Extra query keys to invalidate on reply/resolve (e.g. ['messages'] or ['dashboard-needs-action-messages']) */
  extraInvalidateKeys?: string[][];
}

/**
 * Shared conversation modal actions: reply, pause, resume, resolve, pause-status query.
 * Used by both the Messages page and the Dashboard inline modal.
 */
export function useConversationActions(opts: UseConversationActionsOptions = {}) {
  const t = useTranslations('messages');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const { extraInvalidateKeys = [] } = opts;

  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);

  const invalidateShared = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
    queryClient.invalidateQueries({ queryKey: ['conversation'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-needs-action-comments'] });
    for (const key of extraInvalidateKeys) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  }, [queryClient, extraInvalidateKeys]);

  // --- Reply ---
  const sendReplyMutation = useMutation({
    mutationFn: async ({ messageId, text }: { messageId: string; text: string }) => {
      // One idempotency key per logical send attempt — reused across retries so the
      // backend dedupes if a prior attempt actually reached FB/IG but the response
      // didn't make it back to the phone.
      const clientMessageId = newClientMessageId();
      const MAX_ATTEMPTS = 3;
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await messagesApi.reply(messageId, text, clientMessageId);
          return res.data;
        } catch (err) {
          lastError = err;
          // Only retry transient transport failures from axios — a real backend error
          // (4xx/5xx with a body, e.g. DM_WINDOW_EXPIRED) must surface immediately so the
          // UI can react. The axios.isAxiosError guard prevents us from retrying generic
          // Errors (e.g. test mocks, programmer errors) for 3 seconds before failing.
          const isAxiosTransportFailure = axios.isAxiosError(err) && (isNetworkError(err) || isTimeoutError(err));
          if (attempt < MAX_ATTEMPTS && isAxiosTransportFailure) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
            continue;
          }
          throw err;
        }
      }
      throw lastError;
    },
    onSuccess: (outgoingMessage) => {
      // Update the modal's conversation query cache so fullMessages shows the reply instantly.
      // We read selectedConversation outside setState to keep the updater pure.
      const conv = selectedConversation;
      if (conv) {
        queryClient.setQueryData<Message[]>(
          ['conversation', conv.senderId, conv.lastMessage.pageId],
          (old) => old ? [...old, outgoingMessage] : [outgoingMessage],
        );
      }
      setSelectedConversation(prev => prev ? {
        ...prev,
        messages: [...prev.messages, outgoingMessage],
        lastMessage: outgoingMessage,
      } : null);
      invalidateShared();
    },
    onError: (error: Error) => {
      // Pick a specific message so the agent knows whether this is a Facebook policy
      // problem (window expired, page disconnected) versus a real network problem they
      // can do something about. Generic "replyFailed" was misleading agents into thinking
      // every failure was a connection issue.
      const backendCode = getBackendErrorCode(error);
      toast.error(t(replyErrorTranslationKey(backendCode, error)));
      // Report to Sentry unless the backend flagged this as an expected platform condition
      // (window expired, customer blocked, transient rate limit). Unknown/500s get captured.
      const expectedCodes = new Set(['DM_WINDOW_EXPIRED', 'DM_CUSTOMER_UNAVAILABLE', 'DM_TRANSIENT', 'DM_PLATFORM_AUTH', 'PAGE_DISCONNECTED']);
      if (!backendCode || !expectedCodes.has(backendCode)) {
        captureError(error, 'Failed to send manual reply', {
          tags: { feature: 'messages.reply' },
          extra: { backendCode },
        });
      }
    },
  });

  const handleReply = useCallback((messageId: string, text: string) => {
    sendReplyMutation.mutate({ messageId, text });
  }, [sendReplyMutation]);

  // --- Reply to conversation (no incoming message anchor) ---
  // Used when the customer never DM'd us — only a dual-mode comment reply was sent,
  // so there is no incoming message id to target. Calls the conversation-level endpoint
  // with the customer's senderId directly. Otherwise behaves identically to sendReplyMutation:
  // same idempotency key, same axios-transient retry, same success/error UX.
  const sendConversationReplyMutation = useMutation({
    mutationFn: async ({ senderId, pageId, text }: { senderId: string; pageId: string; text: string }) => {
      const clientMessageId = newClientMessageId();
      const MAX_ATTEMPTS = 3;
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await messagesApi.replyToConversation(senderId, { pageId, replyText: text, clientMessageId });
          return res.data;
        } catch (err) {
          lastError = err;
          const isAxiosTransportFailure = axios.isAxiosError(err) && (isNetworkError(err) || isTimeoutError(err));
          if (attempt < MAX_ATTEMPTS && isAxiosTransportFailure) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
            continue;
          }
          throw err;
        }
      }
      throw lastError;
    },
    onSuccess: (outgoingMessage) => {
      const conv = selectedConversation;
      if (conv) {
        queryClient.setQueryData<Message[]>(
          ['conversation', conv.senderId, conv.lastMessage.pageId],
          (old) => old ? [...old, outgoingMessage] : [outgoingMessage],
        );
      }
      setSelectedConversation(prev => prev ? {
        ...prev,
        messages: [...prev.messages, outgoingMessage],
        lastMessage: outgoingMessage,
      } : null);
      invalidateShared();
    },
    onError: (error: Error) => {
      const backendCode = getBackendErrorCode(error);
      toast.error(t(replyErrorTranslationKey(backendCode, error)));
      const expectedCodes = new Set(['DM_WINDOW_EXPIRED', 'DM_CUSTOMER_UNAVAILABLE', 'DM_TRANSIENT', 'DM_PLATFORM_AUTH', 'PAGE_DISCONNECTED', 'CONVERSATION_NOT_FOUND']);
      if (!backendCode || !expectedCodes.has(backendCode)) {
        captureError(error, 'Failed to send manual reply to conversation', {
          tags: { feature: 'messages.replyToConversation' },
          extra: { backendCode },
        });
      }
    },
  });

  const handleReplyToConversation = useCallback((senderId: string, pageId: string, text: string) => {
    sendConversationReplyMutation.mutate({ senderId, pageId, text });
  }, [sendConversationReplyMutation]);

  // --- Pause ---
  const pauseMutation = useMutation({
    mutationFn: async ({ senderId, pageId }: { senderId: string; pageId: string }) => {
      const res = await messagesApi.pauseConversation(senderId, pageId);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pause-status', variables.senderId] });
      setSelectedConversation(prev => prev ? {
        ...prev,
        pauseStatus: { paused: true, pausedUntil: _data.pausedUntil, remainingMinutes: null },
      } : null);
      toast.warning(t('pauseSuccess'), { id: 'smart-reply-status' });
    },
    onError: () => {
      toast.error(t('pauseFailed'), { id: 'smart-reply-status' });
    },
  });

  const handlePause = useCallback((senderId: string, pageId: string) => {
    pauseMutation.mutate({ senderId, pageId });
  }, [pauseMutation]);

  // --- Resume ---
  const resumeMutation = useMutation({
    mutationFn: async ({ senderId, pageId }: { senderId: string; pageId: string }) => {
      const res = await messagesApi.resumeConversation(senderId, pageId);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pause-status', variables.senderId] });
      setSelectedConversation(prev => prev ? {
        ...prev,
        pauseStatus: { paused: false, pausedUntil: null, remainingMinutes: null },
      } : null);
      toast.success(t('resumeSuccess'), { id: 'smart-reply-status' });
    },
    onError: () => {
      toast.error(t('resumeFailed'), { id: 'smart-reply-status' });
    },
  });

  const handleResume = useCallback((senderId: string, pageId: string) => {
    resumeMutation.mutate({ senderId, pageId });
  }, [resumeMutation]);

  // --- Resolve ---
  const handleResolve = useCallback(async (senderId: string, pageId: string) => {
    try {
      await messagesApi.resolveConversation(senderId, pageId);
      invalidateShared();
      toast.success(t('resolveSuccess'));
      if (selectedConversation?.senderId === senderId) {
        setSelectedConversation(null);
      }
    } catch {
      toast.error(tc('error'));
    }
  }, [invalidateShared, t, tc, selectedConversation]);

  // --- Unresolve ---
  const handleUnresolve = useCallback(async (senderId: string, pageId: string) => {
    try {
      await messagesApi.unresolveConversation(senderId, pageId);
      invalidateShared();
      toast.success(t('unresolveSuccess'));
    } catch {
      toast.error(tc('error'));
    }
  }, [invalidateShared, t, tc]);

  // --- Pause status query ---
  const { data: pauseStatusData } = useQuery({
    queryKey: ['pause-status', selectedConversation?.senderId],
    queryFn: async () => {
      const pageId = selectedConversation!.lastMessage.pageId;
      const res = await messagesApi.getPauseStatus(selectedConversation!.senderId, pageId);
      return res.data;
    },
    enabled: !!selectedConversation?.senderId && !!selectedConversation?.lastMessage.pageId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (pauseStatusData && selectedConversation) {
      setSelectedConversation(prev => prev ? { ...prev, pauseStatus: pauseStatusData } : null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauseStatusData]);

  return {
    selectedConversation,
    setSelectedConversation,
    handleReply,
    handleReplyToConversation,
    handlePause,
    handleResume,
    handleResolve,
    handleUnresolve,
    isReplying: sendReplyMutation.isPending || sendConversationReplyMutation.isPending,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
  };
}
