import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Button, Badge, PlatformIcon, FlagTag, PauseToggle, LimitReachedCTA } from '@/components/ui';
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
  Reply,
  AlertTriangle,
  X,
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
  const tPricing = useTranslations('pricing');
  const tMessages = useTranslations('messages');
  const { dateLocale } = useLanguage();
  
  // Close on ESC
  useEscapeKey(onClose);
  useBodyScrollLock(true);

  const isHeldReply = !comment.replied && !!comment.aiOriginalReply && comment.flagReason?.includes('held_low_confidence');
  const [replyText, setReplyText] = useState(isHeldReply ? comment.aiOriginalReply! : '');
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isGenerating, generationStatus, aiLimit, generatedReply, generate } = useAiGeneration({
    fetchLimitsOnMount: mode === 'full',
  });

  // Pause state
  const [pauseStatus, setPauseStatus] = useState<{ paused: boolean; pausedUntil: string | null; remainingMinutes: number | null } | null>(null);
  const [pauseLoading, setPauseLoading] = useState(false);

  // Auto-focus textarea on open and scroll into view when keyboard appears
  useEffect(() => {
    // Small timeout to allow modal animation to complete
    const timer = setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Scroll textarea into view when focused (keyboard opens on mobile)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const handleFocus = () => {
      // Delay to let the keyboard fully open and viewport resize
      setTimeout(() => {
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 500);
    };
    textarea.addEventListener('focus', handleFocus);
    return () => textarea.removeEventListener('focus', handleFocus);
  }, []);

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
        // Comment was deleted or already handled between loading and replying
        toast.error(t('replyNotFound'));
        onReplySuccess(); // refresh the list
        onClose();
        return;
      }
      captureError(error, 'Failed to send reply', { tags: { component: 'comment-detail', action: 'send-reply' } });
      toast.error(tc('error'));
    } finally {
      setIsSending(false);
    }
  };

  const needsAttention = checkNeedsAttention(comment);
  const isInstagram = comment.source === 'instagram' || (!comment.source && !comment.facebookCommentId);
  const externalUrl = getCommentExternalUrl(comment, pageUrl);

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

        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 md:p-6 pt-2 md:pt-3 border-b border-theme-border">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${needsAttention ? 'icon-bg-red' : 'icon-bg-brand'}`}>
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {mode === 'quick' ? t('reply') : t('commentDetails')}
              </h2>
              <p className="text-sm text-muted-foreground">
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
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pauseStatus?.paused && (
              <Badge variant="info">
                <PauseCircle className="w-3 h-3 me-1" />
                {tMessages('smartReplyPaused')}
              </Badge>
            )}
            {needsAttention && (
              <div className="flex flex-col items-end gap-1">
                <Badge variant="warning">
                  <AlertTriangle className="w-3 h-3 me-1" />
                  {t('needsAttention')}
                </Badge>
                <FlagTag flagReason={comment.flagReason} />
              </div>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
              aria-label={t('close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {/* Post Context */}
          {comment.postMessage && (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-muted rounded-lg text-sm text-muted-foreground">
                <FileText className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="max-h-28 overflow-y-auto min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words leading-relaxed" dir="auto">{comment.postMessage}</p>
                </div>
              </div>
              {postTriggerKeyword && (
                <div className="flex items-center gap-1.5 flex-wrap px-1">
                  <Hash className="w-3.5 h-3.5 flex-shrink-0 text-brand-500" aria-hidden="true" />
                  {parseKeywords(postTriggerKeyword).map((kw, i) => (
                    <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-700" dir="auto">
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Original Comment */}
          <div className="bg-muted rounded-xl p-4">
            <p className="text-foreground whitespace-pre-wrap" dir="auto">{renderMessageText(comment.message)}</p>
            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
              <span title={formatFullTime(comment.createdAt)}>{formatMessageTime(comment.createdAt)}</span>
            </div>
          </div>

          {/* Reply */}
          {mode === 'full' && comment.replied && comment.replyText && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                {t('reply')}
              </h3>
              <div className="bg-brand-50 dark:bg-brand-950/30 rounded-xl p-4 border-s-4 border-brand-500">
                <p className="text-foreground whitespace-pre-wrap" dir="auto">{renderMessageText(comment.replyText)}</p>
                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                  <span title={formatFullTime(comment.repliedAt)}>{formatMessageTime(comment.repliedAt)}</span>
                  <Badge size="sm" variant={comment.replyMethod === 'ai' ? 'info' : 'success'}>
                    {comment.replyMethod === 'ai' ? (
                      <span className="flex items-center gap-1">
                        <Bot className="w-3 h-3" /> {tDashboard('aiReply')}
                      </span>
                    ) : (
                      <>{tDashboard('templateReply')}</>
                    )}
                  </Badge>
                </div>
              </div>
              
              {/* Reply Feedback - AI Only */}
              {comment.replyMethod === 'ai' && <ReplyFeedback commentId={comment.id} />}
            </div>
          )}

          {/* Reply Input Section — show for unreplied OR flagged (needs-attention) comments */}
          {(!comment.replied || needsAttention) && (
            <div className="bg-muted rounded-xl p-4 border border-theme-border">
              {isHeldReply && (
                <div className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-lg status-warning border text-sm">
                  <Bot className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{t('heldReplyBanner')}</span>
                </div>
              )}
              <div className="flex justify-between items-center mb-2">
                <label htmlFor="comment-reply-textarea" className="text-sm font-medium text-foreground">
                  {comment.replied && needsAttention ? t('followUpReply') : t('reply')}
                  {replyText && !isGenerating && (
                    <span className="text-xs font-normal text-muted-foreground ms-2">{t('aiSuggestedReply')}</span>
                  )}
                </label>
                
                {mode === 'full' && (
                  <>
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
                              ? t('regenerate')
                              : tDashboard('aiReply')}
                      </Button>

                      {/* Tooltip for disabled state */}
                      {!aiLimit.allowed && (
                        <div className="absolute bottom-full mb-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-10">
                          {aiLimit.reason || tPricing('limitReached')}
                        </div>
                      )}
                    </div>
                    {!aiLimit.allowed && <LimitReachedCTA />}
                  </>
                )}
              </div>
              <textarea
                id="comment-reply-textarea"
                ref={textareaRef}
                className="w-full p-3 rounded-lg border border-theme-border bg-background focus:ring-2 focus:ring-brand-500 focus:border-transparent min-h-[100px] text-foreground placeholder:text-muted-foreground rtl:placeholder:text-right resize-y"
                placeholder={t('typeReply')}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={isGenerating || isSending}
                dir="auto"
              />
            </div>
          )}

          {/* Resolve/Unresolve — only for comments that need manual attention */}
          {needsAttention && onResolve && (
            <div className="flex justify-center mt-3">
              <button
                onClick={() => { onResolve(); onClose(); }}
                disabled={isSending}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors disabled:opacity-50"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {t('resolve')}
              </button>
            </div>
          )}
          {comment.resolved && onUnresolve && (
            <div className="flex justify-center mt-3">
              <button
                onClick={() => { onUnresolve(); onClose(); }}
                disabled={isSending}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <Undo2 className="w-3.5 h-3.5" />
                {t('unresolve')}
              </button>
            </div>
          )}


        </div>

        {/* Modal Footer — always visible above keyboard */}
        <div
          className="px-4 md:px-6 pb-safe-modal pt-3 border-t border-theme-border bg-card flex-shrink-0"
        >
          {/* Send buttons — shown when reply input is active (unreplied or flagged) */}
          {(!comment.replied || needsAttention) && (
            <div className="flex justify-end gap-2 mb-2">
              <Button variant="secondary" onClick={onClose} disabled={isSending}>
                 {tc('cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleSendReply}
                loading={isSending}
                disabled={!replyText.trim() || isGenerating}
                icon={<Reply className="w-4 h-4" />}
              >
                {t('sendReply')}
              </Button>
            </div>
          )}
          {mode === 'full' && comment.fromId && (
            <PauseToggle
              paused={!!pauseStatus?.paused}
              remainingMinutes={pauseStatus?.remainingMinutes}
              loading={pauseLoading}
              onToggle={handleTogglePause}
            />
          )}
        </div>

      </div>
    </div>,
    document.body
  );
};
