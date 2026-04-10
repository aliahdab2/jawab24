import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { Comment } from '@jawab24/shared';
import {
  AlertTriangle,
  ChevronDown,
  MessageSquare,
  MessageCircle,
  Clock,
} from 'lucide-react';
import { Card } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import { getPrimaryFlag } from '@/utils/flagReason';

// Unified item type for both comments and messages needing attention
export interface NeedsAttentionItem {
  id: string;
  type: 'comment' | 'message';
  senderName: string | null;
  text: string;
  createdAt: string | Date | null;
  flagReason: string | null;
  /** Link path, e.g. "/comments?filter=needs_action" */
  href: string;
  /** For comments: full comment object needed to open detail modal */
  commentData?: Comment;
  /** For messages: sender ID needed to fetch conversation */
  senderId?: string;
  /** For messages: page ID needed to fetch conversation */
  pageId?: string;
  /** Number of messages in this conversation (for grouped message items) */
  messageCount?: number;
  /** Earliest message timestamp in conversation (for "waiting since" display) */
  earliestAt?: string | Date | null;
}

interface SmartStatusBannerProps {
  commentNeedsAction: number;
  messageNeedsAction: number;
  items: NeedsAttentionItem[];
  /** Called when an item is clicked (opens inline modal instead of navigating) */
  onItemClick?: (item: NeedsAttentionItem) => void;
}

/** Default SLA reasons that are obvious from context — no need to show a tag */
const DEFAULT_FLAG_REASONS = ['sla_no_reply', 'no_reply'];

function isNotableFlagReason(flagReason: string | null): boolean {
  const primaryFlag = getPrimaryFlag(flagReason);
  if (!primaryFlag) return false;
  // sla_no_reply:30, sla_no_reply:60 etc. are default — strip the threshold
  const base = primaryFlag.split(':')[0];
  return !DEFAULT_FLAG_REASONS.includes(base);
}

function getReasonTag(
  flagReason: string | null,
  tFlagReason: (key: string) => string,
  tDash: (key: string) => string,
): string {
  const primaryFlag = getPrimaryFlag(flagReason);
  if (primaryFlag) {
    const translated = tFlagReason(primaryFlag);
    if (translated !== primaryFlag) return translated;
    return primaryFlag.replace(/_/g, ' ');
  }
  return tDash('smartBanner.reasonNoReply');
}

export function SmartStatusBanner({
  commentNeedsAction,
  messageNeedsAction,
  items,
  onItemClick,
}: SmartStatusBannerProps) {
  const tDash = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tFlagReason = useTranslations('flagReason');
  const tTime = useTranslations('time');
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  const totalCount = commentNeedsAction + messageNeedsAction;

  // Measure content height for smooth animation
  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [expanded, items]);

  const toggle = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);

  // Don't render if nothing needs action
  if (totalCount === 0) return null;

  // Build breakdown text: "3 comments · 2 messages" (ICU plural-aware)
  const breakdownParts: string[] = [];
  if (commentNeedsAction > 0) {
    breakdownParts.push(tDash('smartBanner.commentsCount', { count: commentNeedsAction }));
  }
  if (messageNeedsAction > 0) {
    breakdownParts.push(tDash('smartBanner.messagesCount', { count: messageNeedsAction }));
  }
  const breakdown = breakdownParts.join(' · ');

  // Items to show (max 5)
  const visibleItems = items.slice(0, 5);
  const hasMore = totalCount > 5;

  // Build "View all" links
  const viewAllLinks: { label: string; href: string }[] = [];
  if (hasMore) {
    if (commentNeedsAction > 0 && messageNeedsAction > 0) {
      viewAllLinks.push({
        label: tDash('smartBanner.viewAllComments', { count: commentNeedsAction }),
        href: '/comments?filter=needs_action',
      });
      viewAllLinks.push({
        label: tDash('smartBanner.viewAllMessages', { count: messageNeedsAction }),
        href: '/messages?filter=needs_action',
      });
    } else if (commentNeedsAction > 0) {
      viewAllLinks.push({
        label: tDash('smartBanner.viewAllItems', { count: totalCount }),
        href: '/comments?filter=needs_action',
      });
    } else {
      viewAllLinks.push({
        label: tDash('smartBanner.viewAllItems', { count: totalCount }),
        href: '/messages?filter=needs_action',
      });
    }
  }

  return (
    <Card
      className={clsx(
        'mb-8 relative overflow-hidden transition-all duration-300',
        'bg-amber-50 border-amber-200 text-amber-900',
        'border-s-4 border-s-amber-500'
      )}
      padding="none"
    >
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-5 text-start cursor-pointer select-none"
        aria-expanded={expanded}
        aria-label={tDash('smartBanner.needsAttention', { count: totalCount })}
      >
        {/* Warning icon */}
        <div className={clsx(
          'w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0',
          'bg-amber-100 text-amber-600 animate-pulse-attention'
        )}>
          <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
        </div>

        {/* Title + breakdown */}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm sm:text-base leading-tight">
            {tDash('smartBanner.needsAttention', { count: totalCount })}
          </p>
          {breakdown && (
            <p className="text-xs sm:text-sm text-amber-700/80 mt-0.5 truncate">
              {breakdown}
            </p>
          )}
        </div>

        {/* Chevron toggle */}
        <div className="shrink-0 p-1">
          <ChevronDown
            className={clsx(
              'w-5 h-5 text-amber-600 transition-transform duration-300',
              expanded && 'rotate-180'
            )}
          />
        </div>
      </button>

      {/* Expandable item list */}
      <div
        style={{ maxHeight: expanded ? `${contentHeight}px` : '0px' }}
        className="transition-[max-height] duration-300 ease-in-out overflow-hidden"
      >
        <div ref={contentRef}>
          <div className="border-t border-amber-200/60">
            {visibleItems.length > 0 ? (
              <ul className="divide-y divide-amber-100/80">
                {visibleItems.map((item) => {
                  const ItemIcon = item.type === 'comment' ? MessageSquare : MessageCircle;
                  const snippet = item.text.length > 60
                    ? `${item.text.slice(0, 60)}…`
                    : item.text;
                  const reason = getReasonTag(item.flagReason, tFlagReason, tDash);

                  const useInlineClick = !!onItemClick && (
                    (item.type === 'message' && !!item.senderId) ||
                    (item.type === 'comment' && !!item.commentData)
                  );
                  const hasMultiple = item.messageCount && item.messageCount > 1;
                  const showReasonTag = isNotableFlagReason(item.flagReason);
                  // For grouped conversations, show "waiting since" (earliest); otherwise show latest
                  const displayTime = hasMultiple && item.earliestAt
                    ? tDash('smartBanner.waitingSince', { time: formatRelativeTime(item.earliestAt, tTime) })
                    : formatRelativeTime(item.createdAt, tTime);

                  const itemContent = (
                    <>
                      {/* Type icon */}
                      <div className="shrink-0 mt-0.5">
                        <ItemIcon className="w-4 h-4 text-amber-600" aria-hidden="true" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold text-amber-900 truncate">
                            {item.senderName || tc('unknownUser')}
                            {hasMultiple && (
                              <span className="text-amber-700/70 font-bold"> ({item.messageCount})</span>
                            )}
                          </span>
                          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700/70">
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {displayTime}
                          </span>
                        </div>
                        <p className="text-xs text-amber-800/70 truncate leading-relaxed">
                          {snippet}
                        </p>
                        {/* Reason tag — only for notable reasons (not default SLA) */}
                        {showReasonTag && (
                          <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-200/60 text-amber-800/80">
                            {reason}
                          </span>
                        )}
                      </div>
                    </>
                  );

                  const sharedClassName = "flex items-start gap-3 px-4 py-3 sm:px-5 sm:py-3.5 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors group w-full text-start";

                  return (
                    <li key={`${item.type}-${item.id}`}>
                      {useInlineClick ? (
                        <button
                          type="button"
                          className={sharedClassName}
                          onClick={() => onItemClick?.(item)}
                        >
                          {itemContent}
                        </button>
                      ) : (
                        <Link
                          href={item.href}
                          className={sharedClassName}
                        >
                          {itemContent}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-4 py-3 text-xs text-amber-700/70">
                {tc('loading')}
              </div>
            )}

            {/* View all link(s) */}
            {viewAllLinks.length > 0 && (
              <div className="flex items-center gap-4 px-4 py-3 sm:px-5 border-t border-amber-200/60">
                {viewAllLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-xs sm:text-sm font-bold text-amber-700 hover:text-amber-900 transition-colors"
                  >
                    {link.label} <span aria-hidden="true" className="rtl:inline-block rtl:rotate-180">→</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
