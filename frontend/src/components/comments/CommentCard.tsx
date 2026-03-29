import React from 'react';
import clsx from 'clsx';
import { Button, FlagTag, PlatformIcon } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import {
  Clock,
  AlertTriangle,
  Sparkles,
  Zap,
  CheckCircle,
  CheckCheck,
  Undo2,
  User,
  FileText,
  ChevronDown,
  MessageSquare,
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
  /** Number of comments in this conversation group */
  groupCount?: number;
  /** Earlier comments in the group (excluding the latest) */
  earlierComments?: Comment[];
  /** Whether earlier comments are currently visible */
  isExpanded?: boolean;
  /** Toggle expand/collapse of earlier comments */
  onToggleExpand?: () => void;
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
  className,
  groupCount,
  earlierComments,
  isExpanded = false,
  onToggleExpand,
}: CommentCardProps) {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const { dateLocale } = useLanguage();
  const needsAttention = checkNeedsAttention(comment);
  const isGrouped = (groupCount ?? 1) > 1;

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
      <PlatformIcon
        platform={isInstagram ? 'instagram' : 'facebook'}
        size="md"
        ariaLabel={isInstagram ? t('platformInstagram') : t('platformFacebook')}
      />
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
             {/* Name, Count Badge & Time */}
             <div className="flex flex-col px-1 mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground truncate">
                     {comment.fromName || tc('unknownUser')}
                  </span>
                  {isGrouped && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-[10px] font-bold">
                      <MessageSquare className="w-2.5 h-2.5" />
                      {t('commentCount', { count: groupCount ?? 0 })}
                    </span>
                  )}
                </div>
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

             {/* Expand/Collapse Earlier Comments */}
             {isGrouped && earlierComments && earlierComments.length > 0 && (
               <>
                 <button
                   type="button"
                   onClick={(e) => {
                     e.stopPropagation();
                     onToggleExpand?.();
                   }}
                   className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
                   aria-expanded={isExpanded}
                 >
                   <ChevronDown className={clsx(
                     "w-3.5 h-3.5 transition-transform duration-200",
                     isExpanded && "rotate-180"
                   )} />
                   {isExpanded ? t('hideEarlier') : t('showEarlier')}
                 </button>

                 {isExpanded && (
                   <div className="flex flex-col gap-2 w-full animate-fade-in">
                     {earlierComments.map((ec) => (
                       <div
                         key={ec.id}
                         className="px-3 py-2 bg-muted/50 rounded-xl border border-theme-border/50 text-xs text-muted-foreground"
                       >
                         <p className="line-clamp-2 text-foreground/80">{ec.message}</p>
                         <span className="text-[10px] mt-1 block">{formatTime(ec.createdAt)}</span>
                       </div>
                     ))}
                   </div>
                 )}
               </>
             )}
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
                     icon={<CheckCircle className="w-3.5 h-3.5" />}
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
              icon={<Undo2 className="w-3.5 h-3.5" />}
            >
              {t('unresolve')}
            </Button>
          </div>
        )}
      </div>

    </div>
  );
});
