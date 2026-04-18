import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { PlatformIcon, PauseToggle, PauseBanner, NeedsAttentionBanner, ReplySourceBadge } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useModalBackHandler } from '@/hooks/useModalBackHandler';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { renderMessageText } from '@/utils/renderMessageText';
import { formatFullTime, formatMessageTime } from '@/utils/dateUtils';
import { messagesApi } from '@/lib/api';
import { useHandoffPauseDuration } from '@/hooks';
import type { Conversation } from './MessageCard';
import {
  User,
  X,
  Send,
  Bot,
  CheckCircle,
  Undo2,
  Mic,
  ExternalLink,
  ChevronRight,
  ArrowDown,
  Loader2,
} from 'lucide-react';
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
  facebookPageId?: string;
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
  facebookPageId,
  isInstagram = false,
}: MessageDetailModalProps) {
  const t = useTranslations('messages');
  const tc = useTranslations('common');
  const tComments = useTranslations('comments');

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
    // Override the global 5-minute staleTime so SSE invalidation
    // triggers an immediate refetch instead of serving cached data.
    staleTime: 0,
  });
  // Use whichever source has more messages — fullMessages (from dedicated query)
  // or conversation.messages (from parent live-sync). This ensures new messages
  // show immediately regardless of which source updates first.
  const messages = fullMessages && fullMessages.length >= conversation.messages.length
    ? fullMessages
    : conversation.messages;

  // Check for held low-confidence reply and pre-fill textarea
  const heldMessage = messages.find(
    m => m.direction === 'incoming' && !m.replied && !!m.aiOriginalReply && m.flagReason?.includes('held_low_confidence')
  );
  const [replyText, setReplyText] = useState(heldMessage?.aiOriginalReply || '');
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const prevMessageCountRef = useRef(messages.length);
  // Track the count of messages when the modal first loaded full data,
  // so newly arrived messages get an entrance animation.
  // Inline ref write (not useEffect) — must be synchronous so the very first
  // render already knows which messages are "old". Ref writes don't trigger
  // re-renders, so this is safe per React docs.
  const initialCountRef = useRef<number | null>(null);
  if (initialCountRef.current === null && fullMessages) {
    initialCountRef.current = fullMessages.length;
  }

  useEscapeKey(() => onClose(), true);
  useBodyScrollLock(true);
  useModalBackHandler(true, onClose);

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

  // When new messages arrive: auto-scroll if near bottom, otherwise show indicator.
  // Flash the "New message" button briefly (2s) even when auto-scrolling as a visual cue.
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      if (isNearBottom) {
        requestAnimationFrame(() => scrollToBottom('smooth'));
        // Brief flash of the indicator so the user notices
        setHasNewMessage(true);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setHasNewMessage(false), 2000);
      } else {
        setHasNewMessage(true);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, isNearBottom, scrollToBottom]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const nearBottom = checkIfNearBottom();
    setIsNearBottom(nearBottom);
    if (nearBottom) setHasNewMessage(false);
  }, [checkIfNearBottom]);

  // Re-scroll to bottom when keyboard opens/closes (container resizes)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (checkIfNearBottom()) {
        requestAnimationFrame(() => scrollToBottom('instant'));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [checkIfNearBottom, scrollToBottom]);

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

  const hasUnresolvedIncoming = messages.some(
    m => m.direction === 'incoming' && !m.resolved
  );
  const hasResolvedIncoming = messages.some(
    m => m.direction === 'incoming' && !!m.resolved
  );

  const isPaused = conversation.pauseStatus?.paused;
  const pauseDuration = useHandoffPauseDuration();

  return createPortal(
    <div
      className="modal-overlay fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 landscape:p-6 landscape:items-center animate-in fade-in duration-200"
      style={{ paddingBottom: 'var(--keyboard-height, 0px)' }}
      onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
      onWheel={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
    >
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-2xl sm:min-h-0 max-h-full sm:max-h-[90vh] overflow-hidden flex flex-col pt-safe sm:pt-0 landscape:pb-2 landscape:px-safe animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200"
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 px-4 md:px-6 pt-3 pb-0 text-xs text-muted-foreground">
          <span className="font-medium">{t('title')}</span>
          <ChevronRight className="w-3 h-3 rtl:rotate-180" />
          {!isInstagram ? (
            <button
              onClick={() => openExternalUrl(
                facebookPageId
                  ? `https://www.facebook.com/${facebookPageId}/inbox/${conversation.senderId}`
                  : `https://www.facebook.com/messages/t/${conversation.senderId}`
              )}
              className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-brand-500 transition-colors truncate"
            >
              <span className="truncate">{conversation.senderName || tc('user')}</span>
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </button>
          ) : (
            <span className="font-semibold text-muted-foreground truncate">{conversation.senderName || tc('user')}</span>
          )}
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
              </div>
              {pageName && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <PlatformIcon
                    platform={isInstagram ? 'instagram' : 'facebook'}
                    size="sm"
                    ariaLabel={isInstagram ? tComments('platformInstagram') : tComments('platformFacebook')}
                  />
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

        {/* Pause state banner — visible when Smart Reply is paused for this customer */}
        <PauseBanner
          paused={!!isPaused}
          remainingMinutes={conversation.pauseStatus?.remainingMinutes}
          totalMinutes={pauseDuration}
          onResumeNow={() => onResume(conversation.senderId, pageId)}
          isResuming={isResuming}
        />

        {/* Message Thread */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 md:p-6 bg-muted/50"
        >
          <div className="min-h-full flex flex-col justify-end gap-4 sm:gap-6">
            {sortedMessages.map((msg, idx) => {
              const isNew = initialCountRef.current !== null && idx >= initialCountRef.current;
              return (
              <div
                key={msg.id}
                className={clsx(
                  "flex flex-col",
                  msg.direction === 'outgoing' ? 'items-end' : 'items-start',
                  isNew && 'animate-in fade-in slide-in-from-bottom-2 duration-300',
                )}
              >
                <div className={clsx(
                  "max-w-[90%] sm:max-w-[85%] rounded-2xl p-3 sm:p-4 shadow-sm",
                  msg.direction === 'outgoing'
                    ? 'bg-brand-600 text-white rounded-be-none'
                    : 'bg-card text-foreground rounded-bs-none border border-theme-border'
                )}>
                  {msg.direction === 'incoming' && msg.attachmentType === 'audio' && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                      <Mic className="w-3 h-3" />
                      <span>{t('voiceMessage')}</span>
                    </div>
                  )}
                  {msg.attachmentType === 'sticker' ? (
                    <p className="text-2xl leading-relaxed">👍</p>
                  ) : (
                    <p className="text-sm leading-relaxed italic-arabic" dir="auto">{renderMessageText(msg.message)}</p>
                  )}
                </div>
                <div className={clsx(
                  "flex items-center gap-2 mt-1.5 text-[10px] font-bold uppercase tracking-tighter",
                  msg.direction === 'outgoing' ? 'text-brand-500' : 'text-muted-foreground'
                )}>
                  <span title={formatFullTime(msg.createdAt, dateLocale)}>{formatMessageTime(msg.createdAt, dateLocale)}</span>
                  {msg.direction === 'outgoing' && (
                    <ReplySourceBadge method={msg.replyMethod} variant="detail" />
                  )}
                </div>
              </div>
              );
            })}
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
          {conversation.needsHumanAttention && (
            <NeedsAttentionBanner
              flagReason={conversation.lastMessage.flagReason}
              onKbLinkClick={onClose}
            />
          )}

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

          {/* Compose row: textarea + send */}
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
              disabled={isReplying}
            />
            <button
              onClick={handleSend}
              disabled={!replyText.trim() || isReplying}
              aria-label={tComments('reply')}
              className="flex-shrink-0 w-[42px] h-[42px] rounded-full btn-primary flex items-center justify-center disabled:opacity-40 transition-all"
            >
              {isReplying
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>

          {/* Actions row: pause/resume (left) + resolve/unresolve (right) */}
          <div className="flex items-start justify-between mt-3 pt-3 border-t border-theme-border">
            <PauseToggle
              paused={!!isPaused}
              remainingMinutes={conversation.pauseStatus?.remainingMinutes}
              loading={isPausing || isResuming}
              onToggle={() => {
                if (isPaused) {
                  onResume(conversation.senderId, pageId);
                } else {
                  onPause(conversation.senderId, pageId);
                }
              }}
            />

            {/* Resolve / Unresolve — end-aligned */}
            {hasUnresolvedIncoming ? (
              <button
                onClick={() => onResolve(conversation.senderId, pageId)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-muted-foreground hover:text-emerald-700 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-900/30"
              >
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                {tComments('resolve')}
              </button>
            ) : hasResolvedIncoming && onUnresolve ? (
              <button
                onClick={() => onUnresolve(conversation.senderId, pageId)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Undo2 className="w-4 h-4 flex-shrink-0" />
                {tComments('unresolve')}
              </button>
            ) : hasResolvedIncoming ? (
              <span className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
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
