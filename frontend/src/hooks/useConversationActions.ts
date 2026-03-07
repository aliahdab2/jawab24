import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { messagesApi } from '@/lib/api';
import { useTranslation, type TranslationKey } from '@/i18n';
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { extraInvalidateKeys = [] } = opts;

  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);

  const invalidateShared = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['messages-stats'] });
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
      setSelectedConversation(prev => prev ? {
        ...prev,
        messages: [...prev.messages, outgoingMessage],
        lastMessage: outgoingMessage,
      } : null);
      invalidateShared();
    },
    onError: (error: Error) => {
      toast.error(error.message || t('messages.replyFailed' as TranslationKey));
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
      toast.warning(t('messages.pauseSuccess' as TranslationKey), { id: 'smart-reply-status' });
    },
    onError: () => {
      toast.error(t('messages.pauseFailed' as TranslationKey), { id: 'smart-reply-status' });
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
      toast.success(t('messages.resumeSuccess' as TranslationKey), { id: 'smart-reply-status' });
    },
    onError: () => {
      toast.error(t('messages.resumeFailed' as TranslationKey), { id: 'smart-reply-status' });
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
      toast.success(t('messages.resolveSuccess' as TranslationKey));
      if (selectedConversation?.senderId === senderId) {
        setSelectedConversation(null);
      }
    } catch {
      toast.error(t('common.error' as TranslationKey));
    }
  }, [invalidateShared, t, selectedConversation]);

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
    isReplying: sendReplyMutation.isPending,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
  };
}
