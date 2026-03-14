import React from 'react';
import clsx from 'clsx';
import { Button, FlagTag } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import {
  Clock,
  AlertTriangle,
  Sparkles,
  Zap,
  CheckCircle,
  CheckCheck,
  User,
  FileText,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Comment } from '@jawab24/shared';

export interface CommentCardProps {
  comment: Comment;
  onClick: () => void;
  onQuickReply?: (e: React.MouseEvent) => void;
  onResolve?: (e: React.MouseEvent) => void;
  onUnresolve?: (e: React.MouseEvent) => void;
  variant?: 'compact' | 'full';
  pageName?: string;
  showPlatformIcon?: boolean;
  animationDelay?: number;
  className?: string;
}

// Keywords that indicate a comment needs human attention
const ATTENTION_KEYWORDS = [
  'human', 'agent', 'help', 'support', 'complaint', 'problem', 'issue',
  'مساعدة', 'بشري', 'شخص', 'موظف', 'مشكلة', 'شكوى'
];

/**
 * Check if a comment needs human attention.
 * Uses backend flag first, falls back to client-side keyword matching
 * for comments that predate the flagging system.
 */
export function checkNeedsAttention(comment: Comment): boolean {
  if (comment.needsAttention) return true;
  if (comment.replied) return false;
  const messageText = comment.message.toLowerCase();
  return ATTENTION_KEYWORDS.some(kw => messageText.includes(kw));
}

// Re-export for backward compatibility (modals and detail views import from here)
export { translateFlagReason } from '@/utils/flagReason';

export const CommentCard = React.memo(function CommentCard({
  comment,
  onClick,
  onQuickReply,
  onResolve,
  onUnresolve,
  variant = 'compact',
  pageName,
  showPlatformIcon = false,
  animationDelay = 0,
  className
}: CommentCardProps) {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const { dateLocale } = useLanguage();
  const needsAttention = checkNeedsAttention(comment);

  const formatTime = (date?: string | Date | null) => {
    if (!date) return '';
    return formatDistanceToNow(new Date(date), {
      addSuffix: true,
      locale: dateLocale
    });
  };

  // Reply Source Indicator Component
  const ReplySourceIndicator = () => {
    if (!comment.replied || !comment.replyMethod) return null;
    const isAI = comment.replyMethod === 'ai';

    return (
      <div className={clsx(
        "w-8 h-8 rounded-full flex items-center justify-center shadow-sm border-2 border-card",
        isAI ? "reply-source-ai" : "reply-source-template"
      )}>
        {isAI ? <Sparkles className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
      </div>
    );
  };

  const isInstagram = comment.source === 'instagram' || (!comment.source && !comment.facebookCommentId);

  const PlatformBadge = () => {
    if (!showPlatformIcon) return null;
    return (
      <span
        className={clsx(
          "inline-flex items-center justify-center w-5 h-5 rounded-full",
          isInstagram
            ? "bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400"
            : "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
        )}
        aria-label={isInstagram ? t('platformInstagram') : t('platformFacebook')}
      >
        {isInstagram ? (
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M7.03013 19.6332C4.98648 19.6332 3.61554 18.2774 3.61554 16.2573V13.8834V7.74268C3.61554 5.72266 4.98648 4.36682 7.03013 4.36682H13.1678H16.9734C19.017 4.36682 20.3879 5.72266 20.3879 7.74268V13.8834V16.2573C20.3879 18.2774 19.017 19.6332 16.9734 19.6332H13.1678H7.03013ZM16.9734 18.4116C18.3375 18.4116 19.167 17.5898 19.167 16.2573V13.8834V7.74268C19.167 6.41016 18.3375 5.58838 16.9734 5.58838H13.1678H7.03013C5.66608 5.58838 4.83658 6.41016 4.83658 7.74268V13.8834V16.2573C4.83658 17.5898 5.66608 18.4116 7.03013 18.4116H13.1678H16.9734ZM12.0017 15.5684C10.0526 15.5684 8.52838 14.072 8.52838 12.006C8.52838 9.94006 10.0526 8.44373 12.0017 8.44373C13.9509 8.44373 15.4751 9.94006 15.4751 12.006C15.4751 14.072 13.9509 15.5684 12.0017 15.5684ZM12.0017 14.3468C13.2847 14.3468 14.2541 13.3854 14.2541 12.006C14.2541 10.6267 13.2847 9.66528 12.0017 9.66528C10.7187 9.66528 9.74933 10.6267 9.74933 12.006C9.74933 13.3854 10.7187 14.3468 12.0017 14.3468ZM16.6853 8.35632C16.2163 8.35632 15.8208 8.01221 15.8208 7.50293C15.8208 6.99365 16.2163 6.64954 16.6853 6.64954C17.1543 6.64954 17.5498 6.99365 17.5498 7.50293C17.5498 8.01221 17.1543 8.35632 16.6853 8.35632Z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036c-2.148 0-2.797 1.66-2.797 3.592v1.402h3.475l-.532 3.665h-2.943v7.98h-5.018Z" />
          </svg>
        )}
      </span>
    );
  };

  return (
    <div
      className={clsx(
        "relative rounded-3xl bg-card border border-theme-border shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] active:duration-[80ms] transition-all duration-200 ease-out overflow-hidden cursor-pointer group",
        needsAttention && 'ring-1 ring-red-100 dark:ring-red-900/50',
        className
      )}
      onClick={onClick}
      style={{ animationDelay: `${animationDelay}s` } as React.CSSProperties}
    >

      {/* Status Badge */}
      {comment.resolved ? (
        <div className="absolute top-4 end-4 z-10 animate-fade-in">
           <div className="flex items-center gap-1.5 px-2 py-1 rounded-full status-success border text-[10px] font-bold uppercase tracking-wider">
             <CheckCheck className="w-3 h-3" />
             {t('resolved')}
           </div>
        </div>
      ) : needsAttention ? (
        <div className="absolute top-4 end-4 z-10 animate-fade-in">
           <div className="flex items-center gap-1.5 px-2 py-1 rounded-full status-error border text-[10px] font-bold uppercase tracking-wider animate-pulse-soft">
             <AlertTriangle className="w-3 h-3" />
             {t('needsAttention')}
           </div>
        </div>
      ) : !comment.replied && (
        <div className="absolute top-4 end-4 z-10 animate-fade-in">
           <div className="flex items-center gap-1.5 px-2 py-1 rounded-full status-warning border text-[10px] font-bold uppercase tracking-wider">
              <Clock className="w-3 h-3" />
              {t('pending')}
           </div>
        </div>
      )}

      <div className="p-5 flex flex-col gap-6">
        
        {/* Customer Message Bubble (Start/Left) */}
        <div className="flex items-start gap-3 me-4 sm:me-8 lg:me-12">
          {/* Avatar */}
          <div className="flex-shrink-0">
             <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground border-2 border-card shadow-sm">
                <User className="w-5 h-5" />
             </div>
          </div>
          
          <div className="flex flex-col items-start gap-1 min-w-0">
             {/* Name & Time */}
             <div className="flex flex-col px-1 mb-1">
                <span className="text-sm font-bold text-foreground truncate">
                   {comment.fromName || tc('unknownUser')}
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                   <span className="text-[10px] text-muted-foreground">
                      {formatTime(comment.createdAt)}
                   </span>
                   <PlatformBadge />
                   {pageName && (
                     <span className="text-xs font-medium text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                       {pageName}
                     </span>
                   )}
                </div>
                <FlagTag flagReason={comment.flagReason} />
             </div>

             {/* Post Context */}
             {comment.postMessage && (
               <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground max-w-full">
                 <FileText className="w-3 h-3 flex-shrink-0" />
                 <span className="truncate max-w-[250px]">{comment.postMessage}</span>
               </div>
             )}

             {/* Message Bubble */}
             <div className="relative group/bubble">
               <div className={clsx(
                  "px-4 py-3 bg-muted rounded-2xl rounded-ss-sm text-foreground text-sm leading-relaxed border border-theme-border",
                  "group-hover:bg-muted/80 transition-colors"
               )}>
                 <p className={clsx(variant === 'compact' ? "line-clamp-3" : "whitespace-pre-wrap")}>
                    {comment.message}
                 </p>
               </div>
             </div>
          </div>
        </div>

        {/* Reply Bubble (End/Right) */}
        {(comment.replied && comment.replyText) ? (
           <div className="flex items-end justify-end gap-3 ms-4 sm:ms-8 lg:ms-12">
              <div className="flex flex-col items-end gap-1 min-w-0">

                 {/* Bubble */}
                 <div className="relative">
                    <div className="px-4 py-3 reply-bubble rounded-2xl rounded-se-sm text-sm leading-relaxed border shadow-sm">
                       <p className={clsx(variant === 'compact' ? "line-clamp-2 italic" : "whitespace-pre-wrap")}>
                          {comment.replyText}
                       </p>
                       <div className="mt-1 flex justify-end">
                          <CheckCircle className="w-3 h-3 text-emerald-500" />
                       </div>
                    </div>
                 </div>
              </div>

               {/* Source Indicator (Zap/Sparkles) */}
              <div className="flex-shrink-0 mb-1">
                 <ReplySourceIndicator />
              </div>
           </div>
        ) : (
           /* Quick Reply + Resolve Actions (if not replied) */
           (onQuickReply || onResolve) && (
             <div className="flex items-center justify-end gap-2 mt-2 animate-fade-in">
                 {onResolve && (
                   <Button
                     size="sm"
                     variant="secondary"
                     className="rounded-xl px-4 py-2 text-xs font-bold"
                     onClick={(e) => {
                       e.stopPropagation();
                       onResolve(e);
                     }}
                     icon={<CheckCheck className="w-3.5 h-3.5" />}
                   >
                     {t('resolve')}
                   </Button>
                 )}
                 {onQuickReply && (
                   <Button
                     size="sm"
                     variant="primary"
                     className="rounded-xl px-5 py-2 shadow-sm text-xs font-bold"
                     onClick={(e) => {
                       e.stopPropagation();
                       onQuickReply(e);
                     }}
                     icon={<Zap className="w-3.5 h-3.5" />}
                   >
                     {t('reply')}
                   </Button>
                 )}
             </div>
           )
        )}

        {/* Unresolve action (shown for handled comments) */}
        {onUnresolve && (
          <div className="flex items-center justify-end mt-2 animate-fade-in">
            <Button
              size="sm"
              variant="secondary"
              className="rounded-xl px-4 py-2 text-xs font-bold"
              onClick={(e) => {
                e.stopPropagation();
                onUnresolve(e);
              }}
              icon={<CheckCheck className="w-3.5 h-3.5" />}
            >
              {t('unresolve')}
            </Button>
          </div>
        )}
      </div>
      
    </div>
  );
});
