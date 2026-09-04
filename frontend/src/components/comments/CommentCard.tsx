import React from 'react';
import clsx from 'clsx';
import { FlagTag, PlatformIcon, ReplySourceBadge, InfoPopover } from '@/components/ui';
import { isKbRelatedFlag } from '@/utils/flagReason';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';
import { renderMessageText } from '@/utils/renderMessageText';
import {
  Clock,
  AlertTriangle,
  CheckCircle,
  CheckCheck,
  User,
  FileText,
  ChevronDown,
  MessageSquare,
} from 'lucide-react';
import { formatMessageTime } from '@/utils/dateUtils';
import { useCardKeyboard, CLICKABLE_CARD_FOCUS } from '@/hooks/useCardKeyboard';
import type { Comment } from '@jawab24/shared';
import { PostReplyIcon } from '@/utils/postReply';

export interface CommentCardProps {
  comment: Comment;
  onClick: () => void;
  onQuickReply?: (e: React.MouseEvent) => void;
  onResolve?: () => void;
  onUnresolve?: () => void;
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
  /** Show a one-time NEW badge to drive first-use discovery */
  showNewBadge?: boolean;
}

/**
 * Whether this comment needs human attention.
 * The backend is the source of truth via the `needsAttention` flag; the client
 * does not do keyword matching of its own.
 */
export function checkNeedsAttention(comment: Comment): boolean {
  return !!comment.needsAttention;
}

// Re-export for backward compatibility (modals and detail views import from here)
export { translateFlagReason } from '@/utils/flagReason';

export const CommentCard = React.memo(function CommentCard({
  comment,
  onClick,
  // onQuickReply/onResolve/onUnresolve accepted but handled by SwipeableCommentCard wrapper
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
  showNewBadge = false,
}: CommentCardProps) {
  const t = useTranslations('comments');
  const tc = useTranslations('common');
  const { dateLocale } = useLanguage();
  const needsAttention = checkNeedsAttention(comment);
  const isGrouped = (groupCount ?? 1) > 1;

  const formatTime = (date?: string | Date | null) => formatMessageTime(date, dateLocale);

  // Avatar initials from sender name
  const initials = comment.fromName
    ? comment.fromName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : null;

  const ReplySourceIndicator = () =>
    comment.replied ? (
      <ReplySourceBadge method={comment.replyMethod} variant="avatar" />
    ) : null;

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

  // Inline status badge — matches MessageCard pattern (no absolute positioning).
  const statusBadge = comment.resolved ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full status-success border text-[10px] font-bold uppercase tracking-wide">
      <CheckCheck className="w-3 h-3" />
      {t('resolved')}
    </span>
  ) : needsAttention ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full status-error border text-[10px] font-bold uppercase tracking-wide animate-pulse-soft">
      <AlertTriangle className="w-3 h-3" />
      {t('needsAttention')}
    </span>
  ) : !comment.replied ? (
    <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full status-warning border text-[10px] font-bold uppercase tracking-wide">
      <Clock className="w-3 h-3" />
      {t('pending')}
    </span>
  ) : null;

  const handleKeyDown = useCardKeyboard(onClick);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('openComment', { name: comment.fromName || tc('unknownUser') })}
      className={clsx(
        "relative rounded-2xl bg-card border border-theme-border/60 hover:border-theme-border",
        "hover:shadow-lg hover:shadow-surface-200/40 dark:hover:shadow-surface-900/30",
        "active:scale-[0.99] active:duration-[80ms] transition-all duration-200 ease-out overflow-hidden cursor-pointer group",
        CLICKABLE_CARD_FOCUS,
        needsAttention && 'border-s-[3px] border-s-red-400 dark:border-s-red-500 bg-red-50/20 dark:bg-red-950/10',
        className
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      style={animationDelay > 0 ? { animationDelay: `${animationDelay}s` } as React.CSSProperties : undefined}
    >

      <div className="p-4 sm:p-5 flex flex-col gap-4 sm:gap-5">

        {/* Customer Message Bubble (Start/Left) */}
        <div className="flex items-start gap-3 me-4 sm:me-8 lg:me-10">
          {/* Avatar */}
          <div className="flex-shrink-0">
             <div className={clsx(
               "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold",
               needsAttention
                 ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                 : "bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-400"
             )}>
                {initials || <User className="w-4 h-4" />}
             </div>
          </div>

          <div className="flex flex-col items-start gap-1 min-w-0">
             {/* Header: name + group-count chip + status badge (inline), then time + platform + page, then flag */}
             <div className="flex flex-col px-1 mb-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground truncate">
                     {comment.fromName || tc('unknownUser')}
                  </span>
                  {isGrouped && (
                    <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 text-[10px] font-bold">
                      <MessageSquare className="w-2.5 h-2.5" />
                      {t('commentCount', { count: groupCount ?? 0 })}
                    </span>
                  )}
                  {statusBadge}
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
                {comment.flagReason ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    <FlagTag flagReason={comment.flagReason} flagMeta={comment.flagMeta} />
                    {isKbRelatedFlag(comment.flagReason) && (
                      <InfoPopover label={tc('info')} panelWidth="sm">
                        <p className="leading-snug">{t('kbGapHint')}</p>
                      </InfoPopover>
                    )}
                  </div>
                ) : null}
             </div>

             {/* Post Context */}
             {comment.postId && (
               <div className="flex items-start gap-1 px-2 py-1 text-[11px] text-muted-foreground w-full">
                 <FileText className="w-3 h-3 flex-shrink-0 text-icon-muted mt-0.5" aria-hidden="true" />
                 <span className="line-clamp-1 break-words" dir="auto">{comment.postMessage || t('postContext')}</span>
               </div>
             )}

             {/* Message Bubble */}
             <div className="relative group/bubble">
               <div className={clsx(
                  "px-4 py-2.5 bg-muted/70 dark:bg-muted/50 rounded-2xl rounded-ss-sm text-foreground text-sm leading-relaxed",
                  "transition-colors"
               )}>
                 <p className={clsx(variant === 'compact' ? "line-clamp-2" : "whitespace-pre-wrap")} dir="auto">
                    {renderMessageText(comment.message)}
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
                         <p className="line-clamp-2 text-foreground/75 dark:text-foreground/80" dir="auto">{renderMessageText(ec.message)}</p>
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
        {comment.replied && comment.replyText && (
           <div className="flex items-end justify-end gap-2.5 ms-4 sm:ms-8 lg:ms-10">
              <div className="flex flex-col items-end gap-1 min-w-0">

                 {/* Bubble */}
                 <div className="relative">
                    <div className="px-4 py-2.5 reply-bubble rounded-2xl rounded-se-sm text-sm leading-relaxed border shadow-sm">
                       {/* dir="auto" — the SAME treatment the incoming comment gets above,
                           and what CommentDetailModal already does for this very field. It
                           was missing only here, so an English reply inside the Arabic
                           dashboard took the page's RTL base direction and painted its
                           trailing punctuation on the wrong side («…for you» rendered
                           «.location and we can check options for you»). */}
                       <p className={clsx(variant === 'compact' ? "line-clamp-2" : "whitespace-pre-wrap")} dir="auto">
                          {comment.replyText}
                       </p>
                       <div className="mt-1 flex justify-end">
                          <CheckCircle className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
                       </div>
                    </div>
                 </div>
              </div>

               {/* Reply source badge (per-method icon) */}
              <div className="flex-shrink-0 mb-1">
                 <ReplySourceIndicator />
              </div>
           </div>
        )}

        {/* Card footer — Post Reply action.
            NOTE: this trigger is POST-scoped (triggerActive = "this post has a keyword set"),
            but it renders on every comment of that post. Ideally lifted to a per-post group
            header so it isn't repeated; kept on the card for now to preserve the shipped
            Post Reply discoverability behaviour. */}
        {comment.postId && onTriggerClick && (
          <div className="flex items-center justify-end gap-2 pt-3 mt-1 border-t border-theme-border/60">
            <div className="relative">
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onTriggerClick(e); }}
                title={triggerActive ? t('postTriggerActiveAria') : t('postTriggerAria')}
                aria-label={triggerActive ? t('postTriggerActiveAria') : t('postTriggerAria')}
                className={clsx(
                  'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs border transition-all',
                  triggerActive
                    // Configured ("on"): quiet, settled confirmation — nothing left to do here,
                    // so it recedes rather than competing for attention.
                    ? 'font-medium border-transparent bg-sky-50/70 dark:bg-sky-900/15 text-sky-700/90 dark:text-sky-300/90'
                    // Not configured: medium-emphasis invite. Indigo is the Post Reply identity
                    // colour, kept tinted (not a saturated fill) so a list of mostly-unconfigured
                    // posts doesn't become a wall of colour — the red "needs attention" state stays
                    // the loudest signal on the card. Discovery punch comes from the NEW badge.
                    : 'font-semibold border-sky-600/30 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 hover:bg-sky-100 hover:border-sky-600/50 dark:hover:bg-sky-900/30'
                )}
              >
                {triggerActive
                  ? <CheckCircle className="w-3 h-3" aria-hidden="true" />
                  : <PostReplyIcon className="w-3 h-3" aria-hidden="true" />}
                {triggerActive ? t('postTriggerActive') : t('postTriggerCta')}
              </button>
              {showNewBadge && !triggerActive && (
                <span className="absolute -top-2 -end-2 px-1.5 py-0.5 rounded-full bg-sky-500 text-white text-[9px] font-bold leading-none shadow-sm pointer-events-none">
                  {t('newBadge')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
});
