import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Badge, PlatformIcon, FlagTag, PauseToggle, SmartReplyButton } from '@/components/ui';
import { ReplyFeedback } from './ReplyFeedback';
import { checkNeedsAttention } from './CommentCard';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { commentsApi, messagesApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import type { Comment } from '@jawab24/shared';
import { parseKeywords } from '@jawab24/shared';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useAiGeneration } from '@/hooks/useAiGeneration';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { renderMessageText } from '@/utils/renderMessageText';
import { getCommentExternalUrl } from '@/utils/pageUrl';
import {
  Sparkles,
  Bot,
  AlertTriangle,
  X,
  Send,
  Loader2,
  ExternalLink,
  CheckCircle,
  Undo2,
  PauseCircle,
  FileText,
  ChevronRight,
  Hash,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface CommentDetailModalProps {
  comment: Comment;
  onClose: () => void;
  onReplySuccess: () => void;
  onResolve?: () => void;
  onUnresolve?: () => void;
  mode?: 'full' | 'quick';
  pageName?: string;
  pageUrl?: string;
  postTriggerKeyword?: string | null;
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
  postTriggerKeyword,
}) => {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const tDashboard = useTranslations('dashboard');
  const tMessages = useTranslations('messages');
  const { dateLocale } = useLanguage();

  useEscapeKey(onClose);
  useBodyScrollLock(true);

  const needsAttention = checkNeedsAttention(comment);
  const isHeldReply = !comment.replied && !!comment.aiOriginalReply && comment.flagReason?.includes('held_low_confidence');
  const isInstagram = comment.source === 'instagram' || (!comment.source && !comment.facebookCommentId);
  const externalUrl = getCommentExternalUrl(comment, pageUrl);
  const showComposeRow = !comment.replied || needsAttention;

  const [replyText, setReplyText] = useState(isHeldReply ? comment.aiOriginalReply! : '');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isGenerating, generationStatus, aiLimit, generatedReply, generate } = useAiGeneration({
    fetchLimitsOnMount: mode === 'full',
  });

  // Pause state
  const [pauseStatus, setPauseStatus] = useState<{ paused: boolean; pausedUntil: string | null; remainingMinutes: number | null } | null>(null);
  const [pauseLoading, setPauseLoading] = useState(false);

  // Auto-focus textarea on open (for unreplied / needs-attention comments)
  useEffect(() => {
    if (!showComposeRow) return;
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync AI-generated reply into textarea
  useEffect(() => {
    if (generatedReply) {
      setReplyText(generatedReply);
    }
  }, [generatedReply]);

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
        setPauseStatus({ paused: false, pausedUntil: null, remainingMinutes: null });
        toast.success(tMessages('resumeSuccess'), { id: 'smart-reply-status' });
      } else {
        const res = await messagesApi.pauseConversation(comment.fromId, comment.pageId);
        setPauseStatus({ paused: true, pausedUntil: res.data.pausedUntil, remainingMinutes: null });
        toast.warning(tMessages('pauseSuccess'), { id: 'smart-reply-status' });
      }
    } catch {
      toast.error(tMessages('pauseFailed'), { id: 'smart-reply-status' });
    } finally {
      setPauseLoading(false);
    }
  };

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

  const handleGenerateAi = () => {
    generate({
      comment: comment.message,
      language: comment.detectedLanguage || undefined,
      context: {},
    });
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

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 landscape:p-6 landscape:items-center animate-in fade-in duration-200"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
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
          <span className="font-semibold text-muted-foreground truncate">{comment.fromName || tc('unknownUser')}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 pt-2 md:pt-3 border-b border-theme-border flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={clsx(
              'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
              needsAttention ? 'icon-bg-red' : 'icon-bg-brand'
            )}>
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground truncate">
                {mode === 'quick' ? t('reply') : t('commentDetails')}
              </h2>
              <p className="text-sm text-muted-foreground truncate">
                {comment.fromName || tc('unknownUser')}
              </p>
              {pageName && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <PlatformIcon
                    platform={isInstagram ? 'instagram' : 'facebook'}
                    size="sm"
                    ariaLabel={isInstagram ? t('platformInstagram') : t('platformFacebook')}
                  />
                  {externalUrl ? (
                    <button
                      onClick={() => openExternalUrl(externalUrl)}
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
              {(pauseStatus?.paused || needsAttention) && (
                <div className="flex items-center gap-2 mt-1">
                  {pauseStatus?.paused && (
                    <Badge variant="info">
                      <PauseCircle className="w-3 h-3 me-1" />
                      {tMessages('smartReplyPaused')}
                    </Badge>
                  )}
                  {needsAttention && (
                    <>
                      <Badge variant="warning">
                        <AlertTriangle className="w-3 h-3 me-1" />
                        {t('needsAttention')}
                      </Badge>
                      <FlagTag flagReason={comment.flagReason} />
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors flex-shrink-0"
            aria-label={t('close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chat Thread */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-muted/50">
          <div className="min-h-full flex flex-col justify-end gap-4">
            {/* Post context snippet */}
            {comment.postMessage && (
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2 px-3 py-2.5 bg-background rounded-lg text-sm text-muted-foreground border border-theme-border">
                  <FileText className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="max-h-28 overflow-y-auto min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words leading-relaxed" dir="auto">{comment.postMessage}</p>
                  </div>
                </div>
                {postTriggerKeyword && (
                  <div className="flex items-center gap-1.5 flex-wrap px-1">
                    <Hash className="w-3.5 h-3.5 flex-shrink-0 text-brand-500" aria-hidden="true" />
                    {parseKeywords(postTriggerKeyword).map((kw, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-700"
                        dir="auto"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Incoming: customer comment */}
            <div className="flex flex-col items-start">
              <div className="max-w-[90%] sm:max-w-[85%] rounded-2xl rounded-bs-none p-3 sm:p-4 shadow-sm bg-card text-foreground border border-theme-border">
                <p className="text-sm leading-relaxed italic-arabic" dir="auto">{renderMessageText(comment.message)}</p>
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-[10px] font-bold uppercase tracking-tighter text-muted-foreground">
                <span title={formatFullTime(comment.createdAt)}>{formatMessageTime(comment.createdAt)}</span>
              </div>
            </div>

            {/* Outgoing: existing reply */}
            {mode === 'full' && comment.replied && comment.replyText && (
              <div className="flex flex-col items-end">
                <div className="max-w-[90%] sm:max-w-[85%] rounded-2xl rounded-be-none p-3 sm:p-4 shadow-sm bg-brand-600 text-white">
                  <p className="text-sm leading-relaxed italic-arabic" dir="auto">{renderMessageText(comment.replyText)}</p>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[10px] font-bold uppercase tracking-tighter text-brand-500">
                  <span title={formatFullTime(comment.repliedAt)}>{formatMessageTime(comment.repliedAt)}</span>
                  {comment.replyMethod && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                      {comment.replyMethod === 'ai' ? (
                        <>
                          <Sparkles className="w-2.5 h-2.5" />
                          {tDashboard('aiReply')}
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-2.5 h-2.5" />
                          {tDashboard('templateReply')}
                        </>
                      )}
                    </div>
                  )}
                </div>
                {comment.replyMethod === 'ai' && <ReplyFeedback commentId={comment.id} />}
              </div>
            )}
          </div>
        </div>

        {/* Footer — always visible above keyboard */}
        <div className="px-4 pt-4 md:px-6 md:pt-4 pb-safe-modal border-t border-theme-border bg-card flex-shrink-0">
          {/* Held reply banner */}
          {isHeldReply && (
            <div className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-lg status-warning border text-sm">
              <Bot className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{t('heldReplyBanner')}</span>
            </div>
          )}

          {/* Smart Reply button — only when compose row is visible */}
          {showComposeRow && mode === 'full' && (
            <div className="flex items-center justify-between mb-2">
              {replyText && !isGenerating && (
                <span className="text-xs text-muted-foreground">{t('aiSuggestedReply')}</span>
              )}
              <div className="flex-1" />
              <SmartReplyButton
                onGenerate={handleGenerateAi}
                isGenerating={isGenerating}
                generationStatus={generationStatus}
                aiLimit={aiLimit}
                hasReply={!!replyText}
                compactOnMobile
              />
            </div>
          )}

          {/* Compose row — only when unreplied or needs attention */}
          {showComposeRow && (
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
                placeholder={comment.replied && needsAttention ? t('followUpReply') : t('typeReply')}
                aria-label={t('typeReply')}
                rows={1}
                className="flex-1 min-w-0 resize-none rounded-2xl border border-theme-border bg-background px-4 py-2.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground rtl:placeholder:text-right focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-card transition-all outline-none"
                style={{ fieldSizing: 'content', minHeight: '42px', maxHeight: '120px' } as React.CSSProperties}
                disabled={isSending || isGenerating}
              />
              <button
                onClick={handleSendReply}
                disabled={!replyText.trim() || isSending || isGenerating}
                aria-label={t('sendReply')}
                className="flex-shrink-0 w-[42px] h-[42px] rounded-full btn-primary flex items-center justify-center disabled:opacity-40 transition-all"
              >
                {isSending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Send className="w-4 h-4" />
                }
              </button>
            </div>
          )}

          {/* Actions row: pause/resume + resolve/unresolve */}
          <div className={clsx(
            'flex items-center justify-between',
            (showComposeRow || isHeldReply) ? 'mt-3' : 'mt-1'
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

      </div>
    </div>,
    document.body
  );
};
