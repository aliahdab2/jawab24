import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useAiGeneration } from '@/hooks/useAiGeneration';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { messagesApi } from '@/lib/api';
import type { Conversation } from './MessageCard';
import {
  User,
  X,
  Send,
  Bot,
  AlertTriangle,
  Sparkles,
  CheckCircle,
  UserCheck,
  PauseCircle,
  PlayCircle,
  ExternalLink,
  ChevronRight,
  ArrowDown,
  Loader2,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import type { Locale } from 'date-fns';

interface MessageDetailModalProps {
  conversation: Conversation;
  onClose: () => void;
  onReply: (messageId: string, text: string) => void;
  onResolve: (senderId: string, pageId: string) => void;
  onUnresolve?: (senderId: string, pageId: string) => void;
  onPause: (senderId: string, pageId: string) => void;
  onResume: (senderId: string, pageId: string) => void;
  isReplying: boolean;
  isPausing: boolean;
  isResuming: boolean;
  dateLocale?: Locale;
  pageName?: string;
  pageUrl?: string;
  isInstagram?: boolean;
}

export function MessageDetailModal({
  conversation,
  onClose,
  onReply,
  onResolve,
  onUnresolve,
  onPause,
  onResume,
  isReplying,
  isPausing,
  isResuming,
  dateLocale,
  pageName,
  pageUrl,
  isInstagram = false,
}: MessageDetailModalProps) {
  const t = useTranslations('messages');
  const tc = useTranslations('common');
  const tComments = useTranslations('comments');
  const tDashboard = useTranslations('dashboard');
  const tPricing = useTranslations('pricing');

  // Fetch full conversation (including outgoing replies) regardless of which tab filter
  // was used to find this conversation. Tabs control which conversations appear in the list,
  // but the detail view always shows the complete thread.
  const pageId = conversation.lastMessage.pageId;
  const { data: fullMessages } = useQuery({
    queryKey: ['conversation', conversation.senderId, pageId],
    queryFn: async () => {
      const res = await messagesApi.getConversation(conversation.senderId, { pageId, limit: 100 });
      return res.data;
    },
  });
  const messages = fullMessages ?? conversation.messages;

  // Check for held low-confidence reply and pre-fill textarea
  const heldMessage = messages.find(
    m => m.direction === 'incoming' && !m.replied && !!m.aiOriginalReply && m.flagReason?.includes('held_low_confidence')
  );
  const [replyText, setReplyText] = useState(heldMessage?.aiOriginalReply || '');
  const [sendError, setSendError] = useState<string | null>(null);
  const { isGenerating, generationStatus, aiLimit, generatedReply, generate } = useAiGeneration();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const prevMessageCountRef = useRef(messages.length);

  useEscapeKey(() => onClose(), true);
  useBodyScrollLock(true);

  // Check if user is scrolled near the bottom (within 100px)
  const checkIfNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setHasNewMessage(false);
  }, []);

  // Auto-scroll to bottom on mount (instant)
  useEffect(() => {
    // Double rAF ensures layout is fully computed before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom('instant');
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When new messages arrive: auto-scroll if near bottom, otherwise show indicator
  useEffect(() => {
    const currentCount = messages.length;
    if (currentCount > prevMessageCountRef.current) {
      if (isNearBottom) {
        requestAnimationFrame(() => scrollToBottom('smooth'));
      } else {
        setHasNewMessage(true);
      }
    }
    prevMessageCountRef.current = currentCount;
  }, [messages.length, isNearBottom, scrollToBottom]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const nearBottom = checkIfNearBottom();
    setIsNearBottom(nearBottom);
    if (nearBottom) setHasNewMessage(false);
  }, [checkIfNearBottom]);

  // Sync AI-generated reply into textarea
  useEffect(() => {
    if (generatedReply) {
      setReplyText(generatedReply);
    }
  }, [generatedReply]);

  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateA - dateB;
    });
  }, [messages]);

  const getReplyTargetMessageId = (): string | null => {
    const incoming = messages
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

  const handleGenerateAi = () => {
    const incoming = sortedMessages.filter(m => m.direction === 'incoming');
    const lastIncoming = incoming[incoming.length - 1];
    if (!lastIncoming) return;

    const conversationHistory = sortedMessages.map(m => ({
      role: m.direction === 'incoming' ? 'user' as const : 'assistant' as const,
      content: m.message,
    }));

    generate({
      comment: lastIncoming.message,
      context: {
        channel: 'dm',
        conversationHistory,
        pageId: conversation.lastMessage.pageId,
      },
    });
  };

  const hasUnrepliedIncoming = messages.some(
    m => m.direction === 'incoming' && !m.replied
  );

  const formatFullTime = (dateValue: string | Date | null | undefined) => {
    if (!dateValue) return '-';
    try {
      return format(new Date(dateValue), 'PPp', { locale: dateLocale });
    } catch {
      return String(dateValue);
    }
  };

  const formatMessageTime = (dateValue: string | Date | null | undefined) => {
    if (!dateValue) return '-';
    try {
      const d = new Date(dateValue);
      const isRecent = Date.now() - d.getTime() < 24 * 60 * 60 * 1000;
      return isRecent
        ? formatDistanceToNow(d, { addSuffix: true, locale: dateLocale })
        : format(d, 'PPp', { locale: dateLocale });
    } catch {
      return String(dateValue);
    }
  };

  const isPaused = conversation.pauseStatus?.paused;
  const hasUnresolvedUnreplied = messages.some(
    m => m.direction === 'incoming' && !m.replied && !m.resolved
  );
  const hasResolvedIncoming = messages.some(
    m => m.direction === 'incoming' && !!m.resolved
  );

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 landscape:p-6 landscape:items-center animate-in fade-in duration-200"
      onTouchMove={(e) => e.preventDefault()}
      onWheel={(e) => e.preventDefault()}
    >
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-2xl min-h-[68dvh] sm:min-h-0 max-h-[calc(100dvh-var(--sai-top)-var(--keyboard-height,0px)-8px)] sm:max-h-[90vh] overflow-hidden flex flex-col pt-safe sm:pt-0 landscape:pb-2 landscape:px-safe animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200"
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 px-4 md:px-6 pt-3 pb-0 text-xs text-muted-foreground">
          <span className="font-medium">{t('title')}</span>
          <ChevronRight className="w-3 h-3 rtl:rotate-180" />
          <span className="font-semibold text-muted-foreground truncate">{conversation.senderName || tc('user')}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 pt-2 md:pt-3 border-b border-theme-border flex-shrink-0">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className={clsx(
              "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
              conversation.needsHumanAttention ? 'icon-bg-red' : 'icon-bg-brand'
            )}>
              <User className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="text-start min-w-0">
              <h2 className="text-lg font-semibold text-foreground leading-tight truncate">
                {conversation.senderName || tc('user')}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-start">
                  {t('msgCount', { count: messages.filter(m => m.direction === 'incoming').length })}
                </span>
                {conversation.needsHumanAttention && (
                  <Badge variant="warning" size="sm">
                    <AlertTriangle className="w-3 h-3 me-1" />
                    {t('needsHuman')}
                  </Badge>
                )}
              </div>
              {pageName && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={clsx(
                      "inline-flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0",
                      isInstagram
                        ? "bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400"
                        : "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                    )}
                    aria-label={isInstagram ? tComments('platformInstagram') : tComments('platformFacebook')}
                  >
                    {isInstagram ? (
                      <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                        <path d="M7.03013 19.6332C4.98648 19.6332 3.61554 18.2774 3.61554 16.2573V13.8834V7.74268C3.61554 5.72266 4.98648 4.36682 7.03013 4.36682H13.1678H16.9734C19.017 4.36682 20.3879 5.72266 20.3879 7.74268V13.8834V16.2573C20.3879 18.2774 19.017 19.6332 16.9734 19.6332H13.1678H7.03013ZM16.9734 18.4116C18.3375 18.4116 19.167 17.5898 19.167 16.2573V13.8834V7.74268C19.167 6.41016 18.3375 5.58838 16.9734 5.58838H13.1678H7.03013C5.66608 5.58838 4.83658 6.41016 4.83658 7.74268V13.8834V16.2573C4.83658 17.5898 5.66608 18.4116 7.03013 18.4116H13.1678H16.9734ZM12.0017 15.5684C10.0526 15.5684 8.52838 14.072 8.52838 12.006C8.52838 9.94006 10.0526 8.44373 12.0017 8.44373C13.9509 8.44373 15.4751 9.94006 15.4751 12.006C15.4751 14.072 13.9509 15.5684 12.0017 15.5684ZM12.0017 14.3468C13.2847 14.3468 14.2541 13.3854 14.2541 12.006C14.2541 10.6267 13.2847 9.66528 12.0017 9.66528C10.7187 9.66528 9.74933 10.6267 9.74933 12.006C9.74933 13.3854 10.7187 14.3468 12.0017 14.3468ZM16.6853 8.35632C16.2163 8.35632 15.8208 8.01221 15.8208 7.50293C15.8208 6.99365 16.2163 6.64954 16.6853 6.64954C17.1543 6.64954 17.5498 6.99365 17.5498 7.50293C17.5498 8.01221 17.1543 8.35632 16.6853 8.35632Z" />
                      </svg>
                    ) : (
                      <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                        <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036c-2.148 0-2.797 1.66-2.797 3.592v1.402h3.475l-.532 3.665h-2.943v7.98h-5.018Z" />
                      </svg>
                    )}
                  </span>
                  {pageUrl ? (
                    <button
                      onClick={() => openExternalUrl(pageUrl)}
                      className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-brand-500 transition-colors cursor-pointer"
                    >
                      <span className="truncate">{pageName}</span>
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    </button>
                  ) : (
                    <span className="text-[10px] font-medium text-muted-foreground truncate">
                      {pageName}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={tComments('close')}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Thread */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 md:p-6 bg-muted/50"
        >
          <div className="min-h-full flex flex-col justify-end gap-4 sm:gap-6">
            {sortedMessages.map((msg) => (
              <div
                key={msg.id}
                className={clsx("flex flex-col", msg.direction === 'outgoing' ? 'items-end' : 'items-start')}
              >
                <div className={clsx(
                  "max-w-[90%] sm:max-w-[85%] rounded-2xl p-3 sm:p-4 shadow-sm",
                  msg.direction === 'outgoing'
                    ? 'bg-brand-600 text-white rounded-be-none'
                    : 'bg-card text-foreground rounded-bs-none border border-theme-border'
                )}>
                  <p className="text-sm leading-relaxed italic-arabic">{msg.message}</p>
                </div>
                <div className={clsx(
                  "flex items-center gap-2 mt-1.5 text-[10px] font-bold uppercase tracking-tighter",
                  msg.direction === 'outgoing' ? 'text-brand-500' : 'text-muted-foreground'
                )}>
                  <span title={formatFullTime(msg.createdAt)}>{formatMessageTime(msg.createdAt)}</span>
                  {msg.direction === 'outgoing' && msg.replyMethod && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                      {msg.replyMethod === 'ai' ? (
                        <>
                          <Sparkles className="w-2.5 h-2.5" />
                          {tDashboard('aiReply')}
                        </>
                      ) : msg.replyMethod === 'template' ? (
                        <>
                          <CheckCircle className="w-2.5 h-2.5" />
                          {tDashboard('templateReply')}
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-2.5 h-2.5" />
                          {tc('manual')}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* New message indicator — shown when user scrolled up and new messages arrived */}
        {hasNewMessage && (
          <div className="absolute bottom-[140px] sm:bottom-[160px] inset-x-0 flex justify-center z-10 pointer-events-none">
            <button
              onClick={() => scrollToBottom('smooth')}
              className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-500 text-white text-xs font-semibold shadow-lg shadow-brand-500/30 hover:bg-brand-600 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              {t('newMessage')}
            </button>
          </div>
        )}

        {/* Footer — Reply + Actions */}
        <div
          className="px-4 pt-4 md:px-6 md:pt-6 pb-safe-modal border-t border-theme-border bg-card flex-shrink-0"
        >
          {heldMessage && (
            <div className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-lg status-warning border text-sm">
              <Bot className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{tComments('heldReplyBanner')}</span>
            </div>
          )}

          {sendError && (
            <div className="mb-3 px-3 py-2 rounded-lg alert-error text-xs font-medium">
              {sendError}
            </div>
          )}

          {/* Smart Reply button */}
          {hasUnrepliedIncoming && (
            <div className="flex items-center justify-between mb-2">
              {replyText && !isGenerating && <span className="text-xs text-muted-foreground">{tComments('aiSuggestedReply')}</span>}
              <div className="flex-1" />
              <div className="relative group/tooltip inline-block">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerateAi}
                  disabled={isGenerating || !aiLimit.allowed}
                  className={clsx(
                    isGenerating ? 'animate-pulse text-brand-600' : 'text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20',
                    !aiLimit.allowed && 'opacity-50 cursor-not-allowed'
                  )}
                  icon={<Bot className="w-4 h-4" />}
                >
                  {isGenerating
                    ? generationStatus || tc('loading')
                    : !aiLimit.allowed
                      ? tPricing('limitReached')
                      : replyText
                        ? tComments('regenerate')
                        : tDashboard('aiReply')}
                </Button>

                {!aiLimit.allowed && (
                  <div className="absolute bottom-full mb-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-10">
                    {aiLimit.reason || tPricing('limitReached')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Compose row: textarea + send button */}
          <div className="flex items-end gap-2">
            <textarea
              value={replyText}
              onChange={(e) => { setReplyText(e.target.value); setSendError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              dir="auto"
              placeholder={t('typeReply')}
              aria-label={t('typeReply')}
              rows={1}
              className="flex-1 min-w-0 resize-none rounded-2xl border border-theme-border bg-background px-4 py-2.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground rtl:placeholder:text-right focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-card transition-all outline-none"
              style={{ fieldSizing: 'content', minHeight: '42px', maxHeight: '120px' } as React.CSSProperties}
              disabled={isReplying || isGenerating}
            />
            <button
              onClick={handleSend}
              disabled={!replyText.trim() || isReplying || isGenerating}
              aria-label={tComments('reply')}
              className="flex-shrink-0 w-[42px] h-[42px] rounded-full btn-primary flex items-center justify-center disabled:opacity-40 transition-all"
            >
              {isReplying
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>

          {/* Actions row: pause/resume + resolve */}
          <div className="flex items-center justify-between mt-4">
            <div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (isPaused) {
                      onResume(conversation.senderId, pageId);
                    } else {
                      onPause(conversation.senderId, pageId);
                    }
                  }}
                  disabled={isPausing || isResuming}
                  aria-label={isPaused ? t('resumeSmartReply') : t('pauseSmartReply')}
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all disabled:opacity-50',
                    isPaused
                      ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30'
                      : 'text-muted-foreground hover:bg-muted dark:hover:bg-white/5'
                  )}
                >
                  {isPaused ? <PlayCircle className="w-3.5 h-3.5" /> : <PauseCircle className="w-3.5 h-3.5" />}
                  <span>{isPaused ? t('resumeSmartReply') : t('pauseSmartReply')}</span>
                </button>
                {conversation.pauseStatus?.paused && conversation.pauseStatus.remainingMinutes != null && (
                  <span className="text-[10px] font-medium text-violet-500">
                    {t('smartReplyPausedRemaining', { minutes: conversation.pauseStatus.remainingMinutes })}
                  </span>
                )}
              </div>
            </div>

            {/* Resolve / Unresolve — end-aligned */}
            {hasUnresolvedUnreplied ? (
              <button
                onClick={() => onResolve(conversation.senderId, pageId)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all text-muted-foreground hover:text-emerald-700 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-900/30"
              >
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {tComments('resolve')}
              </button>
            ) : hasResolvedIncoming && onUnresolve ? (
              <button
                onClick={() => onUnresolve(conversation.senderId, pageId)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {tComments('unresolve')}
              </button>
            ) : hasResolvedIncoming ? (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {t('resolved')}
              </span>
            ) : null}
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
}
