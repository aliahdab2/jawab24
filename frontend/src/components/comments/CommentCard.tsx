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
  showPageName?: boolean;
  showPlatformIcon?: boolean;
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
  showPageName = true,
  showPlatformIcon = false,
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
    return null;
  };

  // Reply Preview Component
  const ReplyPreview = () => {
    if (!comment.replied || !comment.replyText) return null;

    const isAI = comment.replyMethod === 'ai';

    return (
      <div className={clsx(
        "relative overflow-hidden transition-all",
        variant === 'compact'
          ? "mt-3 p-3 bg-brand-50/50 rounded-xl border border-brand-100/50"
          : "mt-4 p-4 bg-brand-50/30 rounded-2xl border border-brand-100"
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
          "relative hover:bg-brand-50/10 transition-all group animate-slide-up cursor-pointer bg-white rounded-2xl shadow-sm hover:shadow-md border border-surface-100/50",
          className
        )}
        onClick={onClick}
        style={{ animationDelay: `${animationDelay}s` } as React.CSSProperties}
      >
        {/* Left Accent Bar */}
        <div className={clsx(
          "absolute inset-y-0 start-0 w-1.5 rounded-l-2xl transition-all",
          comment.replied ? "bg-emerald-500" : "bg-amber-500",
          needsAttention && "bg-red-500"
        )} />

        <div className="p-4 sm:p-5">
          {/* Header: Name + Page + Time */}
          <div className="flex items-start justify-between gap-4 mb-3">
             <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-surface-900 text-[15px]">
                    {comment.fromName || t('common.unknownUser')}
                  </span>
                  
                  {/* Sticker / Status Badge - Integrated into Header */}
                   {(needsAttention) && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-600 animate-pulse-soft">
                        <AlertTriangle className="w-3 h-3" />
                        New
                      </span>
                    )}
                </div>

                <div className="flex items-center gap-2 text-xs text-surface-400">
                    <span>{formatTime(comment.createdAt)}</span>
                    {(showPageName || showPlatformIcon) && (
                      <>
                        <span className="text-surface-300">•</span>
                        <div className="flex items-center gap-1.5 font-medium text-surface-500">
                           {/* Platform Icon */}
                            {showPlatformIcon && (
                              <span className={comment.facebookCommentId ? "text-blue-600" : "text-pink-600"}>
                                {comment.facebookCommentId ? (
                                  <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                                    <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036c-2.148 0-2.797 1.66-2.797 3.592v1.402h3.475l-.532 3.665h-2.943v7.98h-5.018Z" />
                                  </svg>
                                ) : (
                                  <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                                     <path d="M7.03013 19.6332C4.98648 19.6332 3.61554 18.2774 3.61554 16.2573V13.8834V7.74268C3.61554 5.72266 4.98648 4.36682 7.03013 4.36682H13.1678H16.9734C19.017 4.36682 20.3879 5.72266 20.3879 7.74268V13.8834V16.2573C20.3879 18.2774 19.017 19.6332 16.9734 19.6332H13.1678H7.03013ZM16.9734 18.4116C18.3375 18.4116 19.167 17.5898 19.167 16.2573V13.8834V7.74268C19.167 6.41016 18.3375 5.58838 16.9734 5.58838H13.1678H7.03013C5.66608 5.58838 4.83658 6.41016 4.83658 7.74268V13.8834V16.2573C4.83658 17.5898 5.66608 18.4116 7.03013 18.4116H13.1678H16.9734ZM12.0017 15.5684C10.0526 15.5684 8.52838 14.072 8.52838 12.006C8.52838 9.94006 10.0526 8.44373 12.0017 8.44373C13.9509 8.44373 15.4751 9.94006 15.4751 12.006C15.4751 14.072 13.9509 15.5684 12.0017 15.5684ZM12.0017 14.3468C13.2847 14.3468 14.2541 13.3854 14.2541 12.006C14.2541 10.6267 13.2847 9.66528 12.0017 9.66528C10.7187 9.66528 9.74933 10.6267 9.74933 12.006C9.74933 13.3854 10.7187 14.3468 12.0017 14.3468ZM16.6853 8.35632C16.2163 8.35632 15.8208 8.01221 15.8208 7.50293C15.8208 6.99365 16.2163 6.64954 16.6853 6.64954C17.1543 6.64954 17.5498 6.99365 17.5498 7.50293C17.5498 8.01221 17.1543 8.35632 16.6853 8.35632Z" />
                                  </svg>
                                )}
                              </span>
                            )}
                            
                            {showPageName && pageName}
                        </div>
                      </>
                    )}
                </div>
             </div>
             
             {/* Sticker for Replied */}
             {comment.replied && (
                 <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider">
                   <CheckCircle className="w-3 h-3" />
                   {t('comments.replied')}
                 </div>
             )}
          </div>

          {/* Message - Boxed Style */}
          <div className="relative">
             {/* Speech Bubble Arrow */}
             <div className="absolute -top-1.5 start-4 w-3 h-3 bg-surface-50 rotate-45 border-t border-l border-surface-100/60 z-0"></div>
             
             <div className="relative z-10 p-3.5 bg-surface-50 rounded-2xl rounded-tl-sm border border-surface-100/60 mb-3">
               <p className="text-surface-700 text-sm leading-relaxed line-clamp-3">
                 {comment.message}
               </p>
             </div>
          </div>

          {/* Reply Preview */}
          <ReplyPreview />

          {/* Action Button - Moved to bottom right */}
          {!comment.replied && onQuickReply && (
            <div className="flex justify-end mt-2">
                <Button
                  size="sm"
                  variant="primary"
                  className="rounded-xl px-5 py-2 shadow-sm hover:shadow-brand-500/20 text-xs font-bold transition-all hover:scale-105"
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuickReply(e);
                  }}
                  icon={<Zap className="w-3.5 h-3.5" />}
                >
                  {t('comments.quickReply' as any)}
                </Button>
            </div>
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
        "absolute inset-y-0 start-0 w-1.5 transition-all duration-300",
        comment.replied ? "bg-emerald-500" : "bg-amber-500",
        needsAttention && "bg-red-500 w-1.5"
      )} />

       {/* Top-Right Status Badge - Only Replied/Attention */}
       <div className="absolute top-4 end-4">
         <StatusBadge />
       </div>

      <div className="p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          {/* Header section (Name, Time, Page) */}
          <div className="flex items-start justify-between pe-12">
             <div className="flex flex-col gap-1">
                <h3 className="font-bold text-surface-900 text-lg">
                  {comment.fromName || t('common.unknownUser')}
                </h3>
                <div className="flex items-center gap-2 text-xs text-surface-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTime(comment.createdAt)}
                  </span>
                  
                   {/* Sticker / Status for Needs Attention */}
                   {needsAttention && (
                      <>
                        <span className="text-surface-300">•</span>
                        <span className="text-red-600 font-bold uppercase tracking-wider text-[10px] animate-pulse-soft">
                            {t('comments.needsAttention')}
                        </span>
                      </>
                   )}
                </div>
             </div>
          </div>

          {/* Content Section */}
          <div className="flex flex-col lg:flex-row lg:items-start gap-5">
             <div className="flex-1 min-w-0">
                {/* Speech Bubble Box */}
                <div className="relative group/box">
                   <div className="absolute -top-1.5 start-6 w-4 h-4 bg-surface-50 rotate-45 border-t border-l border-surface-100 z-0"></div>
                   <div className="relative z-10 p-4 sm:p-5 bg-surface-50 rounded-2xl rounded-tl-sm border border-surface-100">
                      <p className="text-surface-800 text-base leading-relaxed whitespace-pre-wrap">
                        {comment.message}
                      </p>
                      
                       {/* Post Info inside the box (footer) */}
                      {showPostInfo && (
                        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-surface-200/50">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-surface-400 uppercase tracking-widest">
                            <FileText className="w-3 h-3" />
                            <span>POST: {comment.postId?.slice(0, 8)}</span>
                          </div>
                          
                          {comment.detectedLanguage && (
                              <div className="flex items-center gap-1 text-[10px] font-bold text-surface-400 uppercase tracking-widest">
                                <Globe className="w-3 h-3" />
                                <span>{comment.detectedLanguage === 'ar' ? 'AR' : 'EN'}</span>
                              </div>
                          )}

                          {pageName && (
                              <div className="ms-auto flex items-center gap-1.5 px-2 py-1 bg-white text-brand-700 rounded-lg shadow-sm">
                                <div className="text-[10px] font-bold max-w-[100px] truncate">{pageName}</div>
                              </div>
                          )}
                        </div>
                      )}
                   </div>
                </div>

                <ReplyPreview />
             </div>
             
             {/* Quick Actions - Bottom Right */}
             <div className="flex-shrink-0 flex lg:flex-col justify-end gap-3 mt-2 lg:mt-0">
                {!comment.replied && onQuickReply && (
                  <Button
                    variant="primary"
                    size="md" // Larger on full card
                    className="rounded-xl px-6 shadow-sm hover:shadow-brand-500/20 w-full sm:w-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickReply(e);
                    }}
                    icon={<Zap className="w-4 h-4" />}
                  >
                    {t('comments.reply')}
                  </Button>
                )}
             </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
