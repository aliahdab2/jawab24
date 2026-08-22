import React, { useState, useEffect, useRef, useCallback } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { PlatformIcon, PauseToggle, PauseBanner, NeedsAttentionBanner, ReplySourceBadge, ImageAttachedBadge, CtaButtonPill, DetailSheet } from '@/components/ui';
import { InlineKbEditorModal } from '@/components/knowledge-base/InlineKbEditorModal';
import { ReplyFeedback } from './ReplyFeedback';
import { PostContextCard } from './PostContextCard';
import { checkNeedsAttention } from './CommentCard';
import { useTranslations, useLocale } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';
import { commentsApi, messagesApi, type PauseStatus } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import type { Comment } from '@jawab24/shared';
import { parseKeywords } from '@jawab24/shared';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useHandoffPauseDuration, useSwipe, useArrowKeyNavigation } from '@/hooks';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { renderMessageText } from '@/utils/renderMessageText';
import { getCommentExternalUrl } from '@/utils/pageUrl';
import { isKbGapFlag, getKbGapQuestion } from '@/utils/flagReason';
import { formatFullTime, formatMessageTime } from '@/utils/dateUtils';
import { PostReplyIcon, postReplyIconClass } from '@/utils/postReply';
import {
  Sparkles,
  Bot,
  X,
  Send,
  Loader2,
  ExternalLink,
  CheckCircle,
  Undo2,
  Pencil,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface CommentDetailModalProps {
  comment: Comment;
  onClose: () => void;
  onReplySuccess: () => void;
  onResolve?: () => void;
  onUnresolve?: () => void;
  mode?: 'full' | 'quick';
  pageName?: string;
  pageUrl?: string;
  /** The post's active Post Reply rule, or null when none is configured.
   *  `keyword` is null for any-comment rules (trigger_type 'all'), which are
   *  active rules too — never key "configured" off the keyword alone. */
  postTrigger?: { keyword: string | null } | null;
  /** Open the post's Post Reply config (the parent transitions to the shared
   *  PostTriggerModal). Post-scoped, so it's not stacked inside this modal. */
  onSetupPostReply?: () => void;
  /** Navigate to the previous/next comment in the list without closing. */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export const CommentDetailModal: React.FC<CommentDetailModalProps> = ({
  comment,
  onClose,
  onReplySuccess,
  onResolve,
  onUnresolve,
  mode = 'full',
  pageName,
  pageUrl,
  postTrigger,
  onSetupPostReply,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
}) => {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const tMessages = useTranslations('messages');
  const locale = useLocale();
  const isRtl = isRTLLocale(locale);
  const { dateLocale } = useLanguage();
  const [kbOpen, setKbOpen] = useState(false);

  // Disable the comment's ESC-to-close while the KB editor is layered on top,
  // so ESC closes only the topmost (KB) modal — not both at once.
  useEscapeKey(onClose, !kbOpen);
  useBodyScrollLock(true);

  // When prev/next navigation is enabled, pin the modal to a stable height so
  // the header (and its arrow buttons) doesn't jump between taps as comments of
  // different lengths load. Single-comment usages (e.g. dashboard) stay
  // content-sized.
  const hasNav = !!(onPrev || onNext);

  // Bounded navigation, reused by the header buttons, arrow keys, and swipe.
  const goPrev = useCallback(() => { if (hasPrev) onPrev?.(); }, [hasPrev, onPrev]);
  const goNext = useCallback(() => { if (hasNext) onNext?.(); }, [hasNext, onNext]);

  // Shared icon-button style for the header controls (prev / next / close).
  const iconBtnClass = 'p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors';

  // Keyboard ← / → step through comments (RTL-mirrored). Disabled while the KB
  // editor is layered on top; the hook itself ignores presses while typing.
  useArrowKeyNavigation({ enabled: hasNav && !kbOpen, onPrev: goPrev, onNext: goNext, rtl: isRtl });

  // Swipe ← / → on touch (Android/iOS): horizontal-dominant swipes only, so it
  // never fights the thread's vertical scroll. Mirrored for RTL.
  const swipeHandlers = useSwipe({
    onSwipeLeft: () => { if (hasNav) (isRtl ? goPrev : goNext)(); },
    onSwipeRight: () => { if (hasNav) (isRtl ? goNext : goPrev)(); },
  });

  const needsAttention = checkNeedsAttention(comment);
  const isHeldReply = !comment.replied && !!comment.aiOriginalReply && comment.flagReason?.includes('held_low_confidence');
  const isInstagram = comment.source === 'instagram' || (!comment.source && !comment.facebookCommentId);
  const externalUrl = getCommentExternalUrl(comment, pageUrl);

  const [replyText, setReplyText] = useState(isHeldReply ? comment.aiOriginalReply! : '');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Keeps the comment in view while the keyboard resizes the thread — without
  // it the bottom-anchored thread snaps to its top the moment it overflows.
  const threadRef = useRef<HTMLDivElement>(null);
  useStickToBottom(threadRef);

  // Pause state
  const [pauseStatus, setPauseStatus] = useState<PauseStatus | null>(null);
  const [pauseLoading, setPauseLoading] = useState(false);
  const pauseDuration = useHandoffPauseDuration();

  // Auto-focus the composer on open only for comments you're likely to reply to
  // (unreplied / needs-attention). NOT while prev/next navigation is active: the
  // soft keyboard shrinks the modal (max-h accounts for --keyboard-height), so
  // auto-focusing some comments and not others made the modal — and its nav
  // arrows — jump between heights while arrowing. Tap the box to reply instead.
  useEffect(() => {
    if (hasNav || (comment.replied && !needsAttention)) return;
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
    // Focus once when this comment's modal opens; the modal is keyed by comment id,
    // so it remounts (and re-runs this) on navigation — no reactive deps needed.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch pause status for the commenter
  useEffect(() => {
    if (!comment.fromId || !comment.pageId) return;
    messagesApi.getPauseStatus(comment.fromId, comment.pageId)
      .then(res => setPauseStatus(res.data))
      .catch(() => { /* ignore — pause status is optional */ });
  }, [comment.fromId, comment.pageId]);

  const handleTogglePause = async () => {
    if (!comment.fromId || !comment.pageId) return;
    setPauseLoading(true);
    try {
      if (pauseStatus?.paused) {
        await messagesApi.resumeConversation(comment.fromId, comment.pageId);
        setPauseStatus({ paused: false, pausedUntil: null, reason: null, remainingMinutes: null });
        toast.success(tMessages('resumeSuccess'), { id: 'smart-reply-status' });
      } else {
        const res = await messagesApi.pauseConversation(comment.fromId, comment.pageId);
        setPauseStatus({ paused: true, pausedUntil: res.data.pausedUntil, reason: 'explicit', remainingMinutes: null });
        toast.warning(tMessages('pauseSuccess'), { id: 'smart-reply-status' });
      }
    } catch {
      toast.error(tMessages('pauseFailed'), { id: 'smart-reply-status' });
    } finally {
      setPauseLoading(false);
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setIsSending(true);
    try {
      await commentsApi.reply(comment.id, replyText);
      toast.success(tc('success'));
      onReplySuccess();
      onClose();
    } catch (error) {
      const axiosErr = error as { response?: { status?: number } };
      if (axiosErr.response?.status === 404) {
        toast.error(t('replyNotFound'));
        onReplySuccess();
        onClose();
        return;
      }
      captureError(error, 'Failed to send reply', { tags: { component: 'comment-detail', action: 'send-reply' } });
      toast.error(tc('error'));
    } finally {
      setIsSending(false);
    }
  };

  const accentColor = needsAttention
    ? 'bg-amber-500'
    : comment.resolved
    ? 'bg-emerald-500'
    : pauseStatus?.paused
    ? 'bg-blue-400'
    : 'bg-brand-500';

  return (
    <>
      <DetailSheet
        dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'comment-detail-modal-title' }}
        // Stable desktop height while navigating so the header arrows stay put
        // between taps; mobile is always full-screen (h-full, in DetailSheet).
        panelClassName={hasNav ? 'sm:h-[80vh]' : 'sm:h-auto'}
      >
        {/* Status accent bar */}
        <div className={clsx('h-1 flex-shrink-0', accentColor)} />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4 border-b border-theme-border flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={clsx(
              'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
              needsAttention ? 'icon-bg-red' : 'icon-bg-brand'
            )}>
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id="comment-detail-modal-title" className="text-base font-semibold text-foreground truncate">
                {comment.fromName || tc('unknownUser')}
              </h2>
              {pageName && (
                <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                  <PlatformIcon
                    platform={isInstagram ? 'instagram' : 'facebook'}
                    size="sm"
                    ariaLabel={isInstagram ? t('platformInstagram') : t('platformFacebook')}
                  />
                  {externalUrl ? (
                    <button
                      onClick={() => openExternalUrl(externalUrl)}
                      className="flex items-center gap-1 min-w-0 text-[10px] font-medium text-muted-foreground hover:text-brand-500 transition-colors cursor-pointer"
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
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {(onPrev || onNext) && (
              <>
                {[
                  { onClick: goPrev, disabled: !hasPrev, label: t('previousComment'), Icon: ChevronLeft },
                  { onClick: goNext, disabled: !hasNext, label: t('nextComment'), Icon: ChevronRight },
                ].map(({ onClick, disabled, label, Icon }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    disabled={disabled}
                    className={clsx(iconBtnClass, 'disabled:opacity-30 disabled:cursor-not-allowed')}
                    aria-label={label}
                  >
                    <Icon className="w-5 h-5 rtl:rotate-180" aria-hidden="true" />
                  </button>
                ))}
                <div className="w-px h-5 bg-theme-border mx-1" aria-hidden="true" />
              </>
            )}
            <button onClick={onClose} className={iconBtnClass} aria-label={t('close')}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Pause state banner — visible when Smart Reply is paused for this customer */}
        <PauseBanner
          paused={!!pauseStatus?.paused}
          reason={pauseStatus?.reason}
          remainingMinutes={pauseStatus?.remainingMinutes}
          totalMinutes={pauseDuration}
          onResumeNow={handleTogglePause}
          isResuming={pauseLoading}
        />

        {/* Chat Thread */}
        <div ref={threadRef} className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-6 bg-muted/50" {...swipeHandlers}>
          {/* When navigating (fixed-height modal) anchor content to the top so the
              post + comment stay in the same place across comments; otherwise keep
              the chat-style bottom anchoring near the compose box. */}
          <div className={clsx('min-h-full flex flex-col gap-4', hasNav ? 'justify-start' : 'justify-end')}>
            {/* Post context — a clearly-labeled "Post" card so it reads as the
                post the comment was left on, distinct from the conversation
                bubbles. Clamped (no nested scrollbox) since it's context. */}
            {comment.postMessage && (
              <PostContextCard
                postMessage={comment.postMessage}
                clampLines={6}
                // Post-scoped Post Reply action, kept in the post's own header so it
                // reads as "this post → its auto-reply" and stays out of the thread.
                headerAction={comment.postId && onSetupPostReply ? (
                  <button
                    type="button"
                    onClick={onSetupPostReply}
                    title={postTrigger ? t('postTriggerEdit') : t('postTriggerAria')}
                    aria-label={postTrigger ? t('postTriggerEdit') : t('postTriggerAria')}
                    className={clsx(
                      // Compact, secondary-scale action that lives in the post header.
                      'ms-auto inline-flex items-center gap-1.5 rounded-md text-xs border transition-all',
                      postTrigger
                        // Already configured: quiet "edit" affordance.
                        ? 'px-2 py-0.5 font-medium border-transparent text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40'
                        // Not configured: a card-white chip so the invite stays prominent
                        // against the header band (an sky fill would blend in).
                        : 'px-2 py-0.5 font-medium border-sky-600/30 dark:border-sky-700 bg-card text-sky-700 dark:text-sky-300 hover:bg-sky-50 hover:border-sky-600/50 dark:hover:bg-sky-900/30'
                    )}
                  >
                    {postTrigger
                      ? <Pencil className="w-3 h-3" aria-hidden="true" />
                      : <PostReplyIcon className="w-3 h-3" aria-hidden="true" />}
                    {postTrigger ? t('postTriggerEdit') : t('postTriggerCta')}
                  </button>
                ) : undefined}
                // Configured trigger lives inside the card so the post + its post-reply
                // read as one unit, separated from the post text by a divider. Keyword
                // rules list their keywords; any-comment rules (keyword null) show the
                // mode label instead.
                footer={comment.postId && postTrigger ? (
                  <div className="flex items-center gap-1.5 flex-wrap px-3 pt-2 pb-2.5 border-t border-theme-border">
                    <PostReplyIcon className={clsx('w-3.5 h-3.5 flex-shrink-0', postReplyIconClass)} aria-hidden="true" />
                    {(postTrigger.keyword ? parseKeywords(postTrigger.keyword) : [t('postTriggerModeAll')]).map((kw, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-700"
                        dir="auto"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                ) : undefined}
              />
            )}

            {/* Incoming: customer comment */}
            <div className="flex flex-col items-start">
              <div className="max-w-[90%] sm:max-w-[85%] rounded-2xl rounded-bs-none p-3 sm:p-4 shadow-sm bg-card text-foreground border border-theme-border">
                <p className="text-sm leading-relaxed italic-arabic" dir="auto">{renderMessageText(comment.message)}</p>
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-[10px] font-bold uppercase tracking-tighter text-muted-foreground">
                <span title={formatFullTime(comment.createdAt, dateLocale)}>{formatMessageTime(comment.createdAt, dateLocale)}</span>
              </div>
            </div>

            {/* Outgoing: existing reply */}
            {mode === 'full' && comment.replied && comment.replyText && (
              <div className="flex flex-col items-end">
                {/* The reply is identified by the ReplySourceBadge below the
                    bubble (AI / manual / template / post reply); the bubble's
                    right-aligned brand styling already distinguishes it from the
                    customer's comment, so no separate header label is needed. */}
                <div className="max-w-[90%] sm:max-w-[85%] rounded-2xl rounded-be-none p-3 sm:p-4 shadow-sm bg-brand-600 text-white">
                  <p className="text-sm leading-relaxed italic-arabic" dir="auto">{renderMessageText(comment.replyText)}</p>
                  {/* Post Reply CTA button exactly as the customer received it
                      (delivered-only marker — see reply_cta in FlagMeta). */}
                  {comment.flagMeta?.reply_cta && (
                    <CtaButtonPill label={comment.flagMeta.reply_cta.label} url={comment.flagMeta.reply_cta.url} />
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[10px] font-bold uppercase tracking-tighter text-brand-500">
                  <span title={formatFullTime(comment.repliedAt, dateLocale)}>{formatMessageTime(comment.repliedAt, dateLocale)}</span>
                  <ReplySourceBadge method={comment.replyMethod} variant="detail" />
                  {/* Quiet informational badge — the reply was delivered with an image
                      attached (Post Reply image card). Deliberately NOT an alarm. */}
                  {comment.flagMeta?.reply_image && <ImageAttachedBadge />}
                </div>
                {comment.replyMethod === 'ai' && <ReplyFeedback commentId={comment.id} />}
              </div>
            )}
          </div>
        </div>

        {/* Footer — always visible above keyboard */}
        <div className="px-4 pt-4 md:px-6 md:pt-4 pb-safe-modal border-t border-theme-border bg-card flex-shrink-0">
          {/* Needs attention banner — for a KB gap, the comment text IS the
              unanswered question (fallback when no question was captured). */}
          {needsAttention && (
            <NeedsAttentionBanner
              flagReason={comment.flagReason}
              flagMeta={comment.flagMeta}
              kbGapQuestion={
                getKbGapQuestion(comment.flagReason, comment.flagMeta)
                ?? (isKbGapFlag(comment.flagReason) ? comment.message?.trim() || null : null)
              }
              onAddToKb={comment.pageId ? () => setKbOpen(true) : undefined}
            />
          )}

          {/* Held reply banner */}
          {isHeldReply && (
            <div className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-lg status-warning border text-sm">
              <Bot className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{t('heldReplyBanner')}</span>
            </div>
          )}

          {/* Compose row — always shown so every comment is answerable and the modal
              footer stays consistent while navigating (a follow-up reply on an
              already-replied comment uses the "follow up" placeholder). */}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              id="comment-reply-textarea"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendReply();
                }
              }}
              dir="auto"
              placeholder={comment.replied ? t('followUpReply') : t('typeReply')}
              aria-label={t('typeReply')}
              rows={1}
              className="flex-1 min-w-0 resize-none overscroll-contain rounded-2xl border border-theme-border bg-background px-4 py-2.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground rtl:placeholder:text-right focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-card transition-all outline-none"
              style={{ fieldSizing: 'content', minHeight: '42px', maxHeight: '120px' } as React.CSSProperties}
              disabled={isSending}
            />
            <button
              onClick={handleSendReply}
              disabled={!replyText.trim() || isSending}
              aria-label={t('sendReply')}
              className="flex-shrink-0 w-[42px] h-[42px] rounded-full btn-primary flex items-center justify-center disabled:opacity-40 transition-all"
            >
              {isSending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>

          {/* Actions row: pause/resume + resolve/unresolve */}
          <div className={clsx(
            'flex items-center justify-between',
            'mt-3'
          )}>
            {mode === 'full' && comment.fromId ? (
              <PauseToggle
                paused={!!pauseStatus?.paused}
                remainingMinutes={pauseStatus?.remainingMinutes}
                loading={pauseLoading}
                onToggle={handleTogglePause}
              />
            ) : <div />}

            {needsAttention && onResolve ? (
              <button
                onClick={() => { onResolve(); onClose(); }}
                disabled={isSending}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-emerald-700 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-900/30 transition-colors disabled:opacity-50"
              >
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {t('resolve')}
              </button>
            ) : comment.resolved && onUnresolve ? (
              <button
                onClick={() => { onUnresolve(); onClose(); }}
                disabled={isSending}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                <Undo2 className="w-3.5 h-3.5 flex-shrink-0" />
                {t('unresolve')}
              </button>
            ) : null}
          </div>
        </div>

      </DetailSheet>

      {comment.pageId && (
        <InlineKbEditorModal
          pageId={comment.pageId}
          open={kbOpen}
          onClose={() => setKbOpen(false)}
        />
      )}
    </>
  );
};
