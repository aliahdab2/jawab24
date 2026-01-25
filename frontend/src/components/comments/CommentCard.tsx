import React from 'react';
import clsx from 'clsx';
import { Card, Button } from '@/components/ui';
import { useTranslation } from '@/i18n';
import {
  MessageSquare,
  Clock,
  AlertTriangle,
  Sparkles,
  Zap,
  CheckCircle,
  FileText,
  Globe
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import type { Comment } from '@jawab24/shared';

export interface CommentCardProps {
  comment: Comment;
  onClick: () => void;
  onQuickReply?: (e: React.MouseEvent) => void;
  variant?: 'compact' | 'full';
  pageName?: string;
  showPostInfo?: boolean;
  animationDelay?: number;
  className?: string;
}

// Keywords that indicate a comment needs human attention
const ATTENTION_KEYWORDS = [
  'human', 'agent', 'help', 'support', 'complaint', 'problem', 'issue',
  'مساعدة', 'بشري', 'شخص', 'موظف', 'مشكلة', 'شكوى'
];

/**
 * Check if a comment needs human attention based on keywords
 */
export function checkNeedsAttention(comment: Comment): boolean {
  if (comment.replied) return false;
  const messageText = comment.message.toLowerCase();
  return ATTENTION_KEYWORDS.some(kw => messageText.includes(kw));
}

export function CommentCard({
  comment,
  onClick,
  onQuickReply,
  variant = 'compact',
  pageName,
  showPostInfo = false,
  animationDelay = 0,
  className
}: CommentCardProps) {
  const { t, language } = useTranslation();
  const needsAttention = checkNeedsAttention(comment);

  const formatTime = (date?: string | Date | null) => {
    if (!date) return '';
    return formatDistanceToNow(new Date(date), {
      addSuffix: true,
      locale: language === 'ar' ? ar : enUS
    });
  };

  // Status Badge Component
  const StatusBadge = () => {
    if (needsAttention) {
      return (
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider">
          <AlertTriangle className="w-3 h-3" />
          {t('comments.needsAttention')}
        </div>
      );
    }
    if (comment.replied) {
      return (
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider">
          {variant === 'full' ? <CheckCircle className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
          {t('comments.replied')}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider opacity-60">
        <Clock className="w-3 h-3" />
        {t('dashboard.pending')}
      </div>
    );
  };

  // Reply Preview Component
  const ReplyPreview = () => {
    if (!comment.replied || !comment.replyText) return null;

    const isAI = comment.replyMethod === 'ai';

    return (
      <div className={clsx(
        "relative overflow-hidden",
        variant === 'compact'
          ? "p-3 bg-brand-50/30 rounded-xl border border-brand-100/50 mb-3"
          : "mt-4 p-4 bg-brand-50/20 rounded-2xl border border-brand-100"
      )}>
        {variant === 'full' && (
          <div className="absolute top-0 end-0 p-2 opacity-10">
            <Zap className="w-8 h-8 text-brand-500" />
          </div>
        )}
        <div className={clsx("flex items-center gap-2", variant === 'compact' ? "mb-1" : "mb-2")}>
          <div className={clsx(
            "rounded-md",
            variant === 'compact' ? "p-1" : "p-1 rounded-lg",
            isAI ? "bg-violet-100 text-violet-600" : "bg-emerald-100 text-emerald-600"
          )}>
            {isAI ? <Sparkles className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
          </div>
          <span className={clsx(
            "text-[10px] font-bold uppercase tracking-wider",
            isAI ? "text-violet-700" : "text-emerald-700"
          )}>
            {isAI ? t('dashboard.aiReply') : t('dashboard.templateReply')}
          </span>
        </div>
        <p className={clsx(
          "text-surface-600 italic",
          variant === 'compact' ? "text-xs line-clamp-1" : "text-sm line-clamp-2"
        )}>
          &ldquo;{comment.replyText}&rdquo;
        </p>
      </div>
    );
  };

  // Compact variant (for dashboard)
  if (variant === 'compact') {
    return (
      <div
        className={clsx(
          "relative hover:bg-brand-50/10 transition-all group animate-slide-up cursor-pointer",
          className
        )}
        onClick={onClick}
        style={{ animationDelay: `${animationDelay}s` } as React.CSSProperties}
      >
        {/* Left Accent Bar */}
        <div className={clsx(
          "absolute inset-y-0 start-0 w-1 transition-all",
          comment.replied ? "bg-emerald-500" : "bg-amber-500",
          needsAttention && "bg-red-500 w-1.5"
        )} />

        <div className="ps-5 pe-4 py-4">
          {/* Top-Right Status Badge */}
          <div className="absolute top-3 end-4">
            <StatusBadge />
          </div>

          {/* Header: Name + Page + Time */}
          <div className="flex items-center gap-2 flex-wrap mb-2 pe-24">
            <span className="font-bold text-surface-900">
              {comment.fromName || t('common.unknownUser')}
            </span>
            {pageName && (
              <span className="text-xs font-medium text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">
                {pageName}
              </span>
            )}
            <span className="text-surface-300">•</span>
            <span className="text-xs text-surface-400">
              {formatTime(comment.createdAt)}
            </span>
          </div>

          {/* Message - Quoted Style */}
          <p className="text-surface-600 text-sm leading-relaxed line-clamp-2 italic mb-3">
            &ldquo;{comment.message}&rdquo;
          </p>

          {/* Reply Preview */}
          <ReplyPreview />

          {/* Action Button - Only for pending */}
          {!comment.replied && onQuickReply && (
            <Button
              size="sm"
              variant="primary"
              className="h-8 px-4 rounded-lg shadow-sm hover:shadow-brand-500/20 text-xs font-bold"
              onClick={(e) => {
                e.stopPropagation();
                onQuickReply(e);
              }}
            >
              {t('comments.quickReply' as any)}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Full variant (for comments page)
  return (
    <Card
      hover
      className={clsx(
        "animate-slide-up group/card cursor-pointer border-none shadow-sm hover:shadow-lg transition-all duration-300 rounded-2xl overflow-hidden relative",
        needsAttention && 'ring-1 ring-red-100',
        className
      )}
      style={{ animationDelay: `${animationDelay}s` } as React.CSSProperties}
      onClick={onClick}
    >
      {/* Left Accent Bar */}
      <div className={clsx(
        "absolute inset-y-0 start-0 w-1 transition-all duration-300",
        comment.replied ? "bg-emerald-500" : "bg-amber-500",
        needsAttention && "bg-red-500 w-1.5"
      )} />

      {/* Top-Right Status Badge */}
      <div className="absolute top-4 end-4">
        <StatusBadge />
      </div>

      <div className="p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 sm:gap-6">
          {/* User Info */}
          <div className="flex-1 min-w-0 text-start">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="font-bold text-surface-900 text-lg">
                {comment.fromName || t('common.unknownUser')}
              </span>
              <span className="text-surface-300 hidden sm:inline">•</span>
              <div className="flex items-center gap-1 text-xs font-medium text-surface-400">
                <Clock className="w-3 h-3" />
                {formatTime(comment.createdAt)}
              </div>
            </div>

            <p className="text-surface-700 text-base leading-relaxed mb-4 italic italic-arabic">
              &ldquo;{comment.message}&rdquo;
            </p>

            {/* Post Info */}
            {showPostInfo && (
              <div className="flex items-center gap-3 text-[10px] font-bold text-surface-400 uppercase tracking-widest mb-4 lg:mb-0">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-surface-50 rounded-lg">
                  <FileText className="w-3 h-3" />
                  <span>POST: {comment.postId?.slice(0, 8)}</span>
                </div>
                {comment.detectedLanguage && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-50 text-surface-500">
                    <Globe className="w-3 h-3" />
                    <span>{comment.detectedLanguage === 'ar' ? t('templates.arabic') : t('templates.english')}</span>
                  </div>
                )}
                {pageName && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-50 text-brand-700 rounded-lg">
                    <div className="font-bold max-w-[80px] sm:max-w-[100px] truncate">{pageName}</div>
                  </div>
                )}
              </div>
            )}

            {/* Reply Preview */}
            <ReplyPreview />
          </div>

          {/* Quick Actions */}
          <div className="flex lg:flex-col items-center gap-3 lg:items-end flex-shrink-0 justify-end w-full lg:w-auto mt-2 lg:mt-0 border-t border-surface-100 pt-3 lg:border-0 lg:pt-0">
            {!comment.replied && onQuickReply && (
              <Button
                variant="primary"
                size="sm"
                className="rounded-xl px-4 py-2 transition-all shadow-sm hover:shadow-md group-hover/card:shadow-brand-500/20 w-full sm:w-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickReply(e);
                }}
              >
                {t('comments.reply')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
