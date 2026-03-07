import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Button, Badge } from '@/components/ui';
import { ReplyFeedback } from './ReplyFeedback';
import { useTranslation, type TranslationKey } from '@/i18n';
import { commentsApi, messagesApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import type { Comment } from '@jawab24/shared';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useAiGeneration } from '@/hooks/useAiGeneration';
import { openExternalUrl } from '@/lib/openExternalUrl';
import {
  MessageSquare,
  Bot,
  Reply,
  AlertTriangle,
  X,
  ExternalLink,
  CheckCircle,
  PauseCircle,
  PlayCircle,
  FileText,
  Globe,
  ChevronRight,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface CommentDetailModalProps {
  comment: Comment;
  onClose: () => void;
  onReplySuccess: () => void;
  onResolve?: () => void;
  mode?: 'full' | 'quick';
  pageName?: string;
  pageUrl?: string;
}

export const CommentDetailModal: React.FC<CommentDetailModalProps> = ({
  comment,
  onClose,
  onReplySuccess,
  onResolve,
  mode = 'full',
  pageName,
  pageUrl,
}) => {
  const { t, dateLocale } = useTranslation();
  
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

  // Auto-focus textarea on open
  useEffect(() => {
    // Small timeout to allow modal animation to complete
    const timer = setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Sync AI-generated reply into textarea
  useEffect(() => {
    if (generatedReply) {
      setReplyText(generatedReply);
    }
  }, [generatedReply]);

  // Fetch pause status for the commenter
  useEffect(() => {
    if (!comment.fromId || !comment.postId) return;
    // Use postId as a proxy for pageId context — pause status is per sender
    messagesApi.getPauseStatus(comment.fromId, comment.postId)
      .then(res => setPauseStatus(res.data))
      .catch(() => { /* ignore — pause status is optional */ });
  }, [comment.fromId, comment.postId]);

  const handleTogglePause = async () => {
    if (!comment.fromId || !comment.postId) return;
    setPauseLoading(true);
    try {
      if (pauseStatus?.paused) {
        await messagesApi.resumeConversation(comment.fromId, comment.postId);
        setPauseStatus({ paused: false, pausedUntil: null, remainingMinutes: null });
      } else {
        const res = await messagesApi.pauseConversation(comment.fromId, comment.postId);
        setPauseStatus({ paused: true, pausedUntil: res.data.pausedUntil, remainingMinutes: null });
      }
    } catch {
      /* ignore */
    } finally {
      setPauseLoading(false);
    }
  };

  // Check if comment needs human attention
  const checkNeedsAttention = (c: Comment): boolean => {
    if (c.replied) return false;
    const helpKeywords = ['human', 'agent', 'help', 'support', 'complaint', 'problem', 'issue',
      'مساعدة', 'بشري', 'شخص', 'موظف', 'مشكلة', 'شكوى'];
    const messageText = c.message.toLowerCase();
    return helpKeywords.some(kw => messageText.includes(kw));
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
      language: comment.detectedLanguage || 'en',
      context: {},
    });
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setIsSending(true);
    try {
      await commentsApi.reply(comment.id, replyText);
      toast.success(t('common.success'));
      onReplySuccess();
      onClose();
    } catch (error) {
      const axiosErr = error as { response?: { status?: number } };
      if (axiosErr.response?.status === 404) {
        // Comment was deleted or already handled between loading and replying
        toast.error(t('comments.replyNotFound' as TranslationKey));
        onReplySuccess(); // refresh the list
        onClose();
        return;
      }
      captureError(error, 'Failed to send reply', { tags: { component: 'comment-detail', action: 'send-reply' } });
      toast.error(t('common.error'));
    } finally {
      setIsSending(false);
    }
  };

  const needsAttention = checkNeedsAttention(comment);
  // Prefer specific comment URL (Facebook); fall back to page URL (e.g. Instagram pages)
  const externalUrl = comment.facebookCommentId
    ? `https://facebook.com/${comment.facebookCommentId}`
    : pageUrl;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 landscape:p-6 landscape:items-center animate-in fade-in duration-200"
      onTouchMove={(e) => e.preventDefault()}
      onWheel={(e) => e.preventDefault()}
    >
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-2xl min-h-[68dvh] sm:min-h-0 max-h-[calc(100dvh-var(--sai-top)-8px)] sm:max-h-[90vh] overflow-hidden flex flex-col pt-safe sm:pt-0 pb-safe landscape:pb-2 landscape:px-safe animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200"
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 px-4 md:px-6 pt-3 pb-0 text-xs text-muted-foreground">
          <span className="font-medium">{t('comments.title')}</span>
          <ChevronRight className="w-3 h-3 rtl:rotate-180" />
          <span className="font-semibold text-muted-foreground truncate">{comment.fromName || t('common.unknownUser')}</span>
        </div>

        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 md:p-6 pt-2 md:pt-3 border-b border-theme-border">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${needsAttention ? 'icon-bg-red' : 'icon-bg-brand'}`}>
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {mode === 'quick' ? t('comments.reply') : t('comments.commentDetails')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {comment.fromName || t('common.unknownUser')}
              </p>
              {pageName && (
                externalUrl ? (
                  <button
                    onClick={() => openExternalUrl(externalUrl)}
                    className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground mt-0.5 hover:text-brand-500 transition-colors py-1 -my-1 cursor-pointer"
                  >
                    <Globe className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{pageName}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground mt-0.5">
                    <Globe className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{pageName}</span>
                  </span>
                )
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pauseStatus?.paused && (
              <Badge variant="info">
                <PauseCircle className="w-3 h-3 me-1" />
                {t('messages.smartReplyPaused')}
              </Badge>
            )}
            {needsAttention && (
              <Badge variant="warning">
                <AlertTriangle className="w-3 h-3 me-1" />
                {t('comments.needsAttention')}
              </Badge>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
              aria-label={t('comments.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {/* Post Context */}
          {comment.postMessage && (
            <div className="flex items-start gap-2 px-3 py-2 bg-muted rounded-lg text-sm text-muted-foreground">
              <FileText className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="line-clamp-2">{comment.postMessage}</span>
            </div>
          )}

          {/* Original Comment */}
          <div className="bg-muted rounded-xl p-4">
            <p className="text-foreground whitespace-pre-wrap">{comment.message}</p>
            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
              <span title={formatFullTime(comment.createdAt)}>{formatMessageTime(comment.createdAt)}</span>
            </div>
          </div>

          {/* Reply */}
          {mode === 'full' && comment.replied && comment.replyText && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                {t('comments.reply')}
              </h3>
              <div className="bg-brand-50 dark:bg-brand-950/30 rounded-xl p-4 border-s-4 border-brand-500">
                <p className="text-foreground whitespace-pre-wrap">{comment.replyText}</p>
                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                  <span title={formatFullTime(comment.repliedAt)}>{formatMessageTime(comment.repliedAt)}</span>
                  <Badge size="sm" variant={comment.replyMethod === 'ai' ? 'info' : 'success'}>
                    {comment.replyMethod === 'ai' ? (
                      <span className="flex items-center gap-1">
                        <Bot className="w-3 h-3" /> {t('dashboard.aiReply')}
                      </span>
                    ) : (
                      <>{t('dashboard.templateReply')}</>
                    )}
                  </Badge>
                </div>
              </div>
              
              {/* Reply Feedback - AI Only */}
              {comment.replyMethod === 'ai' && <ReplyFeedback commentId={comment.id} />}
            </div>
          )}

          {/* Reply Input Section */}
          {!comment.replied && (
            <div className="bg-muted rounded-xl p-4 border border-theme-border">
              {isHeldReply && (
                <div className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-lg status-warning border text-sm">
                  <Bot className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{t('comments.heldReplyBanner')}</span>
                </div>
              )}
              <div className="flex justify-between items-center mb-2">
                <label htmlFor="comment-reply-textarea" className="text-sm font-medium text-foreground">
                  {t('comments.reply')}
                  {replyText && !isGenerating && (
                    <span className="text-xs font-normal text-muted-foreground ms-2">{t('comments.aiSuggestedReply')}</span>
                  )}
                </label>
                
                {mode === 'full' && (
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
                        ? generationStatus || t('common.loading')
                        : !aiLimit.allowed
                          ? t('pricing.limitReached')
                          : replyText
                            ? t('comments.regenerate')
                            : t('dashboard.aiReply')}
                    </Button>

                    {/* Tooltip for disabled state */}
                    {!aiLimit.allowed && (
                      <div className="absolute bottom-full mb-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-10">
                        {aiLimit.reason || t('pricing.limitReached')}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <textarea
                id="comment-reply-textarea"
                ref={textareaRef}
                className="w-full p-3 rounded-lg border border-theme-border focus:ring-2 focus:ring-brand-500 focus:border-transparent min-h-[100px] text-foreground placeholder:text-muted-foreground rtl:placeholder:text-right resize-y"
                placeholder={t('comments.typeReply')}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={isGenerating || isSending}
                dir="auto"
              />
              {onResolve && (
                <div className="flex justify-center mt-3">
                  <button
                    onClick={() => { onResolve(); onClose(); }}
                    disabled={isSending}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {t('comments.resolve')}
                  </button>
                </div>
              )}
              <div className="flex justify-end mt-3 gap-2">
                <Button variant="secondary" onClick={onClose} disabled={isSending}>
                   {t('common.cancel')}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSendReply}
                  loading={isSending}
                  disabled={!replyText.trim() || isGenerating}
                  icon={<Reply className="w-4 h-4" />}
                >
                  {t('comments.sendReply')}
                </Button>
              </div>
            </div>
          )}


        </div>

        {/* Modal Footer */}
        {mode === 'full' && (
          <div
            className="px-4 md:px-6 pb-safe-modal pt-3 border-t border-theme-border bg-card"
          >
            <div className="flex items-center justify-between">
              {comment.fromId && (
                <button
                  onClick={handleTogglePause}
                  disabled={pauseLoading}
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all disabled:opacity-50',
                    pauseStatus?.paused
                      ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30'
                      : 'text-muted-foreground hover:bg-muted dark:hover:bg-white/5'
                  )}
                >
                  {pauseStatus?.paused ? (
                    <>
                      <PlayCircle className="w-3.5 h-3.5" />
                      {t('messages.resumeSmartReply')}
                    </>
                  ) : (
                    <>
                      <PauseCircle className="w-3.5 h-3.5" />
                      {t('messages.pauseSmartReply')}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
