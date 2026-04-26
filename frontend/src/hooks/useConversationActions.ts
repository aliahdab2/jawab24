import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Message, messagesApi } from '@/lib/api';
import { useTranslations } from 'next-intl';
import { captureError, getBackendErrorCode } from '@/lib/sentryHelpers';
import type { Conversation } from '@/components/messages';

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
      const res = await messagesApi.reply(messageId, text);
      return res.data;
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
      // Surface a stable, translated message to the user — never leak axios's raw message.
      toast.error(t('replyFailed'));
      // Report to Sentry unless the backend flagged this as an expected platform condition
      // (window expired, customer blocked, transient rate limit). Unknown/500s get captured.
      const expectedCodes = new Set(['DM_WINDOW_EXPIRED', 'DM_CUSTOMER_UNAVAILABLE', 'DM_TRANSIENT', 'DM_PLATFORM_AUTH']);
      const backendCode = getBackendErrorCode(error);
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
    handlePause,
    handleResume,
    handleResolve,
    handleUnresolve,
    isReplying: sendReplyMutation.isPending,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
  };
}
