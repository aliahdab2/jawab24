import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { PlatformIcon, PauseToggle, PauseBanner, NeedsAttentionBanner, ReplySourceBadge, ImageAttachedBadge, CtaButtonPill, DetailSheet, InfoPopover } from '@/components/ui';
import { InlineKbEditorModal } from '@/components/knowledge-base/InlineKbEditorModal';
import { useTranslations } from 'next-intl';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { buildWhatsAppUrl } from '@/lib/whatsapp';
import { renderMessageText, stripImageDescription } from '@/utils/renderMessageText';
import { isKbRelatedFlag, isKbGapFlag, getKbGapQuestion } from '@/utils/flagReason';
import { formatFullTime, formatMessageTime } from '@/utils/dateUtils';
import { formatInternationalPhone, resolveCustomerLabel } from '@/utils/phone';
import { messagesApi } from '@/lib/api';
import { useHandoffPauseDuration, useCopyToClipboard, useStickToBottom } from '@/hooks';
import type { Conversation } from './MessageCard';
import {
  User,
  X,
  Send,
  Bot,
  CheckCircle,
  Undo2,
  Mic,
  Image as ImageIcon,
  ExternalLink,
  ChevronRight,
  ArrowDown,
  Loader2,
  Copy,
  Check,
  Minimize2,
} from 'lucide-react';
import type { Locale } from 'date-fns';

interface MessageDetailModalProps {
  conversation: Conversation;
  onClose: () => void;
  onReply: (messageId: string, text: string) => void;
  /** Conversation-level send used when the customer never DM'd (e.g., dual-mode comment
   *  reply). When the modal has no incoming-message target, handleSend falls back to this. */
  onReplyToConversation: (senderId: string, pageId: string, text: string) => void;
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
  /** Conversation channel — drives the platform badge and the external chat link */
  platform?: 'facebook' | 'instagram' | 'whatsapp';
}

export function MessageDetailModal({
  conversation,
  onClose,
  onReply,
  onReplyToConversation,
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
  platform: platformProp,
}: MessageDetailModalProps) {
  const t = useTranslations('messages');
  const tc = useTranslations('common');
  const tComments = useTranslations('comments');
  const platform = platformProp ?? (isInstagram ? 'instagram' : 'facebook');

  // For WhatsApp the senderId IS the customer's phone number (wa_id); it's the
  // only stable identity (display names are self-set). Shown under the name, and
  // used as the name fallback. Empty for FB/IG (opaque PSIDs, never a number).
  const customerNumber = platform === 'whatsapp' ? formatInternationalPhone(conversation.senderId) : '';
  // Header/breadcrumb label: name → number → generic. `isPhone` drives dir="ltr".
  const { label: customerLabel, isPhone: labelIsNumber } = resolveCustomerLabel(conversation.senderName, customerNumber, tc('user'));
  const { copied: numberCopied, copy: copyNumber } = useCopyToClipboard();

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
  // The unanswered question behind a KB-gap flag (info/price/phone) — surfaced
  // in the NeedsAttentionBanner so the merchant knows exactly what to add to
  // Business Info. Prefer the question captured at flag time (flag_meta); fall
  // back to the flagged message's own text for rows flagged before capture existed.
  const flaggedKbGap = messages.find(m => isKbGapFlag(m.flagReason));
  const kbGapQuestion = flaggedKbGap
    ? getKbGapQuestion(flaggedKbGap.flagReason, flaggedKbGap.flagMeta) ?? flaggedKbGap.message?.trim() ?? null
    : null;
  const [replyText, setReplyText] = useState(heldMessage?.aiOriginalReply || '');
  const [sendError, setSendError] = useState<string | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
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

  // Disable the conversation's ESC-to-close while the KB editor is layered on
  // top, so ESC closes only the topmost (KB) modal — not both at once.
  useEscapeKey(() => onClose(), !kbOpen);
  useBodyScrollLock(true);

  // Thread scrolling, incl. the re-pin to the bottom when the keyboard
  // opens/closes (container resize) — shared with the comment and test modals.
  const { isNearBottom: checkIfNearBottom, scrollToBottom: scrollThreadToBottom } = useStickToBottom(scrollContainerRef);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
    scrollThreadToBottom(behavior);
    setHasNewMessage(false);
  }, [scrollThreadToBottom]);

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
    const trimmed = replyText.trim();
    if (!trimmed) return;
    const targetId = getReplyTargetMessageId();
    // Comment-only customers (dual-mode reply path) have no incoming message anchor;
    // fall back to the conversation-level endpoint using the customer's senderId.
    if (targetId) {
      onReply(targetId, trimmed);
    } else {
      onReplyToConversation(conversation.senderId, pageId, trimmed);
    }
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

  return (
    <>
      <DetailSheet
        dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'message-detail-modal-title' }}
        panelClassName="sm:h-auto"
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 px-4 md:px-6 pt-3 pb-0 text-xs text-muted-foreground">
          <span className="font-medium">{t('title')}</span>
          <ChevronRight className="w-3 h-3 rtl:rotate-180" />
          {platform === 'whatsapp' ? (
            <button
              onClick={() => openExternalUrl(buildWhatsAppUrl(conversation.senderId, ''))}
              className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-brand-500 transition-colors truncate"
            >
              <span className="truncate" dir={labelIsNumber ? 'ltr' : undefined}>{customerLabel}</span>
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </button>
          ) : platform === 'facebook' ? (
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
              <h2 id="message-detail-modal-title" className="text-lg font-semibold text-foreground leading-tight truncate" dir={labelIsNumber ? 'ltr' : undefined}>
                {customerLabel}
              </h2>
              {/* Customer phone (WhatsApp only), tap to copy. Shown under the name;
                  when the name is missing it's already the h2, so don't repeat it. */}
              {customerNumber && conversation.senderName && (
                <button
                  type="button"
                  onClick={() => copyNumber(customerNumber)}
                  title={numberCopied ? t('copied') : t('copyNumber')}
                  aria-label={numberCopied ? t('copied') : `${t('copyNumber')}: ${customerNumber}`}
                  className="group/phone flex items-center gap-1 -ms-1 mt-0.5 px-1 py-0.5 rounded text-xs text-muted-foreground hover:text-brand-500 transition-colors"
                >
                  <span dir="ltr" className="tabular-nums">{customerNumber}</span>
                  {numberCopied ? (
                    <Check className="w-3 h-3 flex-shrink-0 text-brand-500" aria-hidden="true" />
                  ) : (
                    // Always visible (muted) — a hover-only icon has no affordance on
                    // touch, and this inbox is used mostly on mobile.
                    <Copy className="w-3 h-3 flex-shrink-0 text-icon-muted group-hover/phone:text-brand-500 transition-colors" aria-hidden="true" />
                  )}
                </button>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-start">
                  {t('msgCount', { count: messages.filter(m => m.direction === 'incoming').length })}
                </span>
              </div>
              {pageName && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <PlatformIcon
                    platform={platform}
                    size="sm"
                    ariaLabel={platform === 'instagram' ? tComments('platformInstagram') : platform === 'whatsapp' ? tComments('platformWhatsApp') : tComments('platformFacebook')}
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
          reason={conversation.pauseStatus?.reason}
          remainingMinutes={conversation.pauseStatus?.remainingMinutes}
          totalMinutes={pauseDuration}
          onResumeNow={() => onResume(conversation.senderId, pageId)}
          isResuming={isResuming}
        />

        {/* Message Thread */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-6 bg-muted/50"
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
                    <span className="inline-flex items-center gap-1 mb-1.5 ps-1.5 pe-2 py-0.5 rounded-full icon-bg-blue text-[11px] font-medium">
                      <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('voiceMessage')}
                    </span>
                  )}
                  {msg.direction === 'incoming' && msg.attachmentType === 'image' && (
                    <span className="inline-flex items-center gap-1 mb-1.5 ps-1.5 pe-2 py-0.5 rounded-full icon-bg-brand text-[11px] font-medium">
                      <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('imageMessage')}
                    </span>
                  )}
                  {msg.attachmentType === 'sticker' ? (
                    <p className="text-2xl leading-relaxed">👍</p>
                  ) : (
                    <p className="text-sm leading-relaxed italic-arabic" dir="auto">
                      {renderMessageText(msg.attachmentType === 'image' ? stripImageDescription(msg.message) : msg.message)}
                    </p>
                  )}
                  {/* Post Reply CTA button exactly as the customer received it
                      (delivered-only marker — see reply_cta in FlagMeta). */}
                  {msg.direction === 'outgoing' && msg.flagMeta?.reply_cta && (
                    <CtaButtonPill label={msg.flagMeta.reply_cta.label} url={msg.flagMeta.reply_cta.url} />
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
                  {/* Quiet informational badge — the reply was auto-shortened by the
                      truncation retry. Deliberately NOT an alarm (no needs-attention). */}
                  {msg.direction === 'outgoing' && msg.flagMeta?.reply_shortened && (
                    <span className="inline-flex items-center gap-1 normal-case tracking-normal font-medium">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border status-info text-[10px]">
                        <Minimize2 className="w-3 h-3" aria-hidden="true" />
                        {t('replyShortened')}
                      </span>
                      <InfoPopover label={tc('info')} panelWidth="sm">
                        <p>{t('replyShortenedHint')}</p>
                      </InfoPopover>
                    </span>
                  )}
                  {/* Quiet informational badge — the reply was delivered with an image
                      attached (Post Reply image card). Deliberately NOT an alarm. */}
                  {msg.direction === 'outgoing' && msg.flagMeta?.reply_image && <ImageAttachedBadge />}
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
          {/* Banner also shows when a KB-related flag is set, even after the AI
              sent a fallback reply (which flips needsHumanAttention=false). */}
          {(conversation.needsHumanAttention || isKbRelatedFlag(conversation.lastMessage.flagReason)) && (
            <NeedsAttentionBanner
              flagReason={conversation.lastMessage.flagReason}
              flagMeta={conversation.lastMessage.flagMeta}
              kbGapQuestion={kbGapQuestion}
              onAddToKb={pageId ? () => setKbOpen(true) : undefined}
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
              className="flex-1 min-w-0 resize-none overscroll-contain rounded-2xl border border-theme-border bg-background px-4 py-2.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground rtl:placeholder:text-right focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-card transition-all outline-none"
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

          {/* Actions row: pause/resume (ghost, start) + resolve/unresolve (end).
              Resolve is the primary affordance → filled teal; Pause stays ghost. */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-theme-border">
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
                onClick={() => { onResolve(conversation.senderId, pageId); onClose(); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold btn-primary transition-all"
              >
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                {tComments('resolve')}
              </button>
            ) : hasResolvedIncoming && onUnresolve ? (
              <button
                onClick={() => { onUnresolve(conversation.senderId, pageId); onClose(); }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-theme-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
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

      </DetailSheet>

      {pageId && (
        <InlineKbEditorModal
          pageId={pageId}
          open={kbOpen}
          onClose={() => setKbOpen(false)}
        />
      )}
    </>
  );
}
