import React, { useState, useMemo } from 'react';
import clsx from 'clsx';
import { Button, Badge } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import type { Conversation } from './MessageCard';
import {
  User,
  X,
  Send,
  AlertTriangle,
  Sparkles,
  CheckCircle,
  UserCheck,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import type { Locale } from 'date-fns';

interface MessageDetailModalProps {
  conversation: Conversation;
  onClose: () => void;
  onReply: (messageId: string, text: string) => void;
  onResolve: (senderId: string, pageId: string) => void;
  onPause: (senderId: string, pageId: string) => void;
  onResume: (senderId: string, pageId: string) => void;
  isReplying: boolean;
  isPausing: boolean;
  isResuming: boolean;
  dateLocale?: Locale;
}

export function MessageDetailModal({
  conversation,
  onClose,
  onReply,
  onResolve,
  onPause,
  onResume,
  isReplying,
  isPausing,
  isResuming,
  dateLocale,
}: MessageDetailModalProps) {
  const { t } = useTranslation();
  const [replyText, setReplyText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  useEscapeKey(() => onClose(), true);
  useBodyScrollLock(true);

  const sortedMessages = useMemo(() => {
    return [...conversation.messages].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateA - dateB;
    });
  }, [conversation.messages]);

  const getReplyTargetMessageId = (): string | null => {
    const incoming = conversation.messages
      .filter(m => m.direction === 'incoming')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const unreplied = incoming.find(m => !m.replied);
    return unreplied?.id || incoming[0]?.id || null;
  };

  const handleSend = () => {
    if (!replyText.trim()) return;
    const targetId = getReplyTargetMessageId();
    if (!targetId) return;
    onReply(targetId, replyText.trim());
    setReplyText('');
    setSendError(null);
  };

  const formatFullTime = (dateValue: string | Date | null | undefined) => {
    if (!dateValue) return '-';
    try {
      return format(new Date(dateValue), 'PPp', { locale: dateLocale });
    } catch {
      return String(dateValue);
    }
  };

  const pageId = conversation.lastMessage.pageId;
  const isPaused = conversation.pauseStatus?.paused;
  const hasUnresolvedUnreplied = conversation.messages.some(
    m => m.direction === 'incoming' && !m.replied && !m.resolved
  );
  const hasResolvedIncoming = conversation.messages.some(
    m => m.direction === 'incoming' && !!m.resolved
  );

  return (
    <div
      className="fixed inset-0 bg-surface-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 pt-safe"
      onTouchMove={(e) => e.preventDefault()}
      onWheel={(e) => e.preventDefault()}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[calc(100dvh-var(--sai-top)-12px)] sm:max-h-[90vh] landscape:max-h-[95vh] overflow-hidden flex flex-col animate-scale-in"
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-surface-100 flex-shrink-0">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className={clsx(
              "w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-inner flex-shrink-0",
              conversation.needsHumanAttention ? 'bg-red-100 text-red-600' : 'bg-brand-100 text-brand-600'
            )}>
              <User className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="text-start min-w-0">
              <h2 className="text-base sm:text-xl font-bold text-surface-900 leading-tight truncate">
                {conversation.senderName || t('common.user' as TranslationKey)}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold text-surface-400 uppercase tracking-widest text-start">
                  {t('messages.msgCount' as TranslationKey, { count: conversation.messages.length })}
                </span>
                {conversation.needsHumanAttention && (
                  <Badge variant="warning" size="sm">
                    <AlertTriangle className="w-3 h-3 me-1" />
                    {t('messages.needsHuman')}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('comments.close' as TranslationKey)}
            className="p-2 sm:p-2.5 rounded-xl hover:bg-surface-100 text-surface-400 transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6 bg-surface-50/50">
          {sortedMessages.map((msg) => (
            <div
              key={msg.id}
              className={clsx("flex flex-col", msg.direction === 'outgoing' ? 'items-end' : 'items-start')}
            >
              <div className={clsx(
                "max-w-[90%] sm:max-w-[85%] rounded-2xl p-3 sm:p-4 shadow-sm",
                msg.direction === 'outgoing'
                  ? 'bg-brand-600 text-white rounded-be-none'
                  : 'bg-white text-surface-900 rounded-bs-none border border-surface-100'
              )}>
                <p className="text-sm leading-relaxed italic-arabic">{msg.message}</p>
              </div>
              <div className={clsx(
                "flex items-center gap-2 mt-1.5 text-[10px] font-bold uppercase tracking-tighter",
                msg.direction === 'outgoing' ? 'text-brand-500' : 'text-surface-400'
              )}>
                <span>{formatFullTime(msg.createdAt)}</span>
                {msg.direction === 'outgoing' && msg.replyMethod && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-100 text-surface-600">
                    {msg.replyMethod === 'ai' ? (
                      <>
                        <Sparkles className="w-2.5 h-2.5" />
                        {t('dashboard.aiReply')}
                      </>
                    ) : msg.replyMethod === 'template' ? (
                      <>
                        <CheckCircle className="w-2.5 h-2.5" />
                        {t('dashboard.templateReply')}
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-2.5 h-2.5" />
                        {t('common.manual' as TranslationKey)}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer — Reply + Actions */}
        <div
          className="p-4 sm:p-6 border-t border-surface-100 bg-white flex-shrink-0"
          style={{ paddingBottom: 'calc(var(--sai-bottom) + 12px)' }}
        >
          {sendError && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-medium">
              {sendError}
            </div>
          )}
          <div className="flex items-end gap-2 sm:gap-3">
            <div className="flex-1">
              <textarea
                value={replyText}
                onChange={(e) => { setReplyText(e.target.value); setSendError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t('messages.typeReply' as TranslationKey)}
                rows={1}
                className="w-full resize-none rounded-xl sm:rounded-2xl border border-surface-200 bg-surface-50 px-3 sm:px-4 py-2.5 sm:py-3 text-sm text-surface-900 placeholder:text-surface-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-white transition-all outline-none"
                style={{ minHeight: '40px', maxHeight: '120px' }}
                disabled={isReplying}
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSend}
              loading={isReplying}
              disabled={!replyText.trim() || isReplying}
              className="rounded-xl px-3 sm:px-4 h-[40px] sm:h-[44px] flex-shrink-0"
              icon={<Send className="w-4 h-4" />}
            >
              <span className="hidden sm:inline">{t('comments.reply')}</span>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {/* Pause/Resume Smart Reply */}
              <button
                onClick={() => {
                  if (isPaused) {
                    onResume(conversation.senderId, pageId);
                  } else {
                    onPause(conversation.senderId, pageId);
                  }
                }}
                disabled={isPausing || isResuming}
                className={clsx(
                  'flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[9px] sm:text-[10px] font-bold uppercase tracking-wider transition-all border',
                  isPaused
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-violet-50 text-violet-600 border-violet-200 hover:bg-violet-100'
                )}
              >
                {isPaused ? (
                  <>
                    <PlayCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    {t('messages.resumeSmartReply' as TranslationKey)}
                  </>
                ) : (
                  <>
                    <PauseCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    {t('messages.pauseSmartReply' as TranslationKey)}
                  </>
                )}
              </button>
              {conversation.pauseStatus?.paused && conversation.pauseStatus.remainingMinutes != null && (
                <span className="text-[9px] sm:text-[10px] font-medium text-violet-500">
                  {t('messages.smartReplyPausedRemaining' as TranslationKey, { minutes: conversation.pauseStatus.remainingMinutes })}
                </span>
              )}

              {/* Resolve button */}
              {hasUnresolvedUnreplied ? (
                <button
                  onClick={() => onResolve(conversation.senderId, pageId)}
                  className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[9px] sm:text-[10px] font-bold uppercase tracking-wider transition-all border bg-surface-50 text-surface-600 border-surface-200 hover:bg-surface-100"
                >
                  <CheckCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  {t('comments.resolve' as TranslationKey)}
                </button>
              ) : hasResolvedIncoming ? (
                <span className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border bg-emerald-50 text-emerald-700 border-emerald-200">
                  <CheckCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  {t('messages.resolved' as TranslationKey)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
