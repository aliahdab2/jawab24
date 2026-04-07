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
  /** Called when the trigger ⚡ button on the post context line is clicked */
  onTriggerClick?: (e: React.MouseEvent) => void;
  /** Whether this post has an active trigger keyword set */
  triggerActive?: boolean;
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
  onTriggerClick,
  triggerActive = false,
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

  // Avatar initials from sender name
  const initials = comment.fromName
    ? comment.fromName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : null;

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
        "relative rounded-2xl bg-card border border-theme-border/60 hover:border-theme-border",
        "hover:shadow-lg hover:shadow-surface-200/40 dark:hover:shadow-surface-900/30",
        "active:scale-[0.99] active:duration-[80ms] transition-all duration-200 ease-out overflow-hidden cursor-pointer group",
        needsAttention && 'border-s-[3px] border-s-red-400 dark:border-s-red-500 bg-red-50/20 dark:bg-red-950/10',
        className
      )}
      onClick={onClick}
      style={animationDelay > 0 ? { animationDelay: `${animationDelay}s` } as React.CSSProperties : undefined}
    >

      {/* Status Badge */}
      {comment.resolved ? (
        <div className="absolute top-3.5 end-3.5 z-10 animate-fade-in">
           <div className="flex items-center gap-1 px-2 py-0.5 rounded-full status-success border text-[10px] font-bold uppercase tracking-wide">
             <CheckCheck className="w-3 h-3" />
             {t('resolved')}
           </div>
        </div>
      ) : needsAttention ? (
        <div className="absolute top-3.5 end-3.5 z-10 animate-fade-in">
           <div className="flex items-center gap-1 px-2 py-0.5 rounded-full status-error border text-[10px] font-bold uppercase tracking-wide animate-pulse-soft">
             <AlertTriangle className="w-3 h-3" />
             {t('needsAttention')}
           </div>
        </div>
      ) : !comment.replied && (
        <div className="absolute top-3.5 end-3.5 z-10 animate-fade-in">
           <div className="flex items-center gap-1 px-2 py-0.5 rounded-full status-warning border text-[10px] font-bold uppercase tracking-wide">
              <Clock className="w-3 h-3" />
              {t('pending')}
           </div>
        </div>
      )}

      <div className="p-4 sm:p-5 flex flex-col gap-4 sm:gap-5">

        {/* Customer Message Bubble (Start/Left) */}
        <div className="flex items-start gap-3 me-4 sm:me-8 lg:me-10">
          {/* Avatar */}
          <div className="flex-shrink-0">
             <div className={clsx(
               "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 border-card shadow-sm",
               needsAttention
                 ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                 : "bg-brand-50 text-brand-600 dark:bg-brand-900/20 dark:text-brand-400"
             )}>
                {initials || <User className="w-5 h-5" />}
             </div>
          </div>

          <div className="flex flex-col items-start gap-1 min-w-0">
             {/* Name, Count Badge & Time */}
             <div className="flex flex-col px-1 mb-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground truncate">
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
                   <span className="text-[10px] text-subtle">
                      {formatTime(comment.createdAt)}
                   </span>
                   <PlatformBadge />
                   {pageName && (
                     <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 bg-muted/60 dark:bg-muted/40 rounded">
                       {pageName}
                     </span>
                   )}
                </div>
                <FlagTag flagReason={comment.flagReason} className="mt-0.5" />
             </div>

             {/* Post Context + Trigger Button */}
             {comment.postId && (
               <div className="flex flex-col gap-1 w-full">
                 <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground max-w-full">
                   <FileText className="w-3 h-3 flex-shrink-0 text-icon-muted" aria-hidden="true" />
                   <span className="truncate max-w-[220px]">{comment.postMessage || t('postContext')}</span>
                 </div>
                 {onTriggerClick && (
                   <button
                     type="button"
                     onClick={e => { e.stopPropagation(); onTriggerClick(e); }}
                     className={clsx(
                       'self-start flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
                       triggerActive
                         ? 'border-brand-400 text-brand-500 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20'
                         : 'border-dashed border-theme-border text-muted-foreground hover:border-brand-400 hover:text-brand-500'
                     )}
                   >
                     <Zap className="w-3 h-3" aria-hidden="true" />
                     {triggerActive ? t('postTriggerActive') : t('postTrigger')}
                   </button>
                 )}
               </div>
             )}

             {/* Message Bubble */}
             <div className="relative group/bubble">
               <div className={clsx(
                  "px-4 py-2.5 bg-muted/70 dark:bg-muted/50 rounded-2xl rounded-ss-sm text-foreground text-sm leading-relaxed",
                  "transition-colors"
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
                   <div className="flex flex-col gap-1.5 w-full animate-fade-in">
                     {earlierComments.map((ec) => (
                       <div
                         key={ec.id}
                         className="px-3 py-2 bg-muted/40 dark:bg-muted/25 rounded-xl text-xs text-muted-foreground"
                       >
                         <p className="line-clamp-2 text-foreground/75 dark:text-foreground/80">{ec.message}</p>
                         <span className="text-[10px] text-subtle mt-1 block">{formatTime(ec.createdAt)}</span>
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
           <div className="flex items-end justify-end gap-2.5 ms-4 sm:ms-8 lg:ms-10">
              <div className="flex flex-col items-end gap-1 min-w-0">

                 {/* Bubble */}
                 <div className="relative">
                    <div className="px-4 py-2.5 reply-bubble rounded-2xl rounded-se-sm text-sm leading-relaxed border shadow-sm">
                       <p className={clsx(variant === 'compact' ? "line-clamp-2" : "whitespace-pre-wrap")}>
                          {comment.replyText}
                       </p>
                       <div className="mt-1 flex justify-end">
                          <CheckCircle className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
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
           /* Quick Reply + Resolve Actions (if not replied) — hover-reveal on desktop */
           (onQuickReply || onResolve) && (
             <div className={clsx(
               "flex items-center justify-end gap-2 animate-fade-in",
               "sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-150"
             )}>
                 {onResolve && (
                   <Button
                     size="sm"
                     variant="secondary"
                     className="rounded-xl px-3 py-1.5 text-xs font-medium"
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
                     className="rounded-xl px-4 py-1.5 shadow-sm text-xs font-medium"
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

        {/* Unresolve action (shown for handled comments) — hover-reveal on desktop */}
        {onUnresolve && (
          <div className={clsx(
            "flex items-center justify-end animate-fade-in",
            "sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-150"
          )}>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-xl px-3 py-1.5 text-xs font-medium"
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
