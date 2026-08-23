import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { Comment } from '@jawab24/shared';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  MessageSquare,
  MessageCircle,
  Clock,
  Phone,
  X,
} from 'lucide-react';
import { Card, PlatformIcon, PLATFORM_LABEL_KEYS } from '@/components/ui';
import { SwipeDismissWrapper } from '@/components/ui/SwipeDismissWrapper';
import { useTranslations, useLocale } from 'next-intl';
import { formatRelativeTime } from '@/utils/dateUtils';
import { getPrimaryFlag, translateFlagReason, type FlagMetaShape } from '@/utils/flagReason';
import { useTimedDismiss } from '@/hooks/useTimedDismiss';

// Unified item type for both comments and messages needing attention
export interface NeedsAttentionItem {
  id: string;
  type: 'comment' | 'message';
  /** Channel a message conversation is on — replaces the row's type icon.
   *  Only set for message items on multi-channel workspaces. */
  platform?: 'facebook' | 'instagram' | 'whatsapp' | null;
  senderName: string | null;
  text: string;
  createdAt: string | Date | null;
  flagReason: string | null;
  flagMeta?: import('@jawab24/shared').FlagMeta | null;
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

/** Workspace-wide leads sitting at `new` — rendered as ONE aggregate row, never
 *  one row per lead: a 19-lead queue would bury the comment/message rows that
 *  share this banner. */
export interface LeadsAttentionSummary {
  count: number;
  latestName: string | null;
  latestAt: string | null;
  /** Arrival of the OLDEST waiting lead — the queue's urgency (see the row). */
  oldestAt?: string | null;
}

interface SmartStatusBannerProps {
  commentNeedsAction: number;
  messageNeedsAction: number;
  /** Omit (or pass count 0) to hide the leads row entirely. */
  leads?: LeadsAttentionSummary;
  items: NeedsAttentionItem[];
  /** Called when an item is clicked (opens inline modal instead of navigating) */
  onItemClick?: (item: NeedsAttentionItem) => void;
  /** Swap the type icon for the channel on message rows (multi-channel only). */
  showChannelBadge?: boolean;
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
  flagMeta: FlagMetaShape | null | undefined,
  tFlagReason: (key: string, params?: Record<string, string>) => string,
  tDash: (key: string) => string,
  locale: string,
): string {
  const primaryFlag = getPrimaryFlag(flagReason);
  if (primaryFlag) {
    const translated = translateFlagReason(primaryFlag, tFlagReason, locale, flagMeta);
    return translated === primaryFlag ? primaryFlag.replace(/_/g, ' ') : translated;
  }
  return tDash('smartBanner.reasonNoReply');
}

export function SmartStatusBanner({
  commentNeedsAction,
  messageNeedsAction,
  leads,
  items,
  onItemClick,
  showChannelBadge = false,
}: SmartStatusBannerProps) {
  const tDash = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tComments = useTranslations('comments');
  const tFlagReason = useTranslations('flagReason');
  const tTime = useTranslations('time');
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  const leadsCount = leads?.count ?? 0;
  const totalCount = commentNeedsAction + messageNeedsAction + leadsCount;

  const { dismissed, dismiss: handleDismiss } = useTimedDismiss({
    key: 'smartBannerDismissedAt',
    durationMs: 24 * 60 * 60 * 1000,
    count: totalCount,
  });

  const shouldHide = totalCount === 0 || dismissed;

  // Measure content height for smooth animation
  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [expanded, items]);

  const toggle = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);

  // Don't render if nothing needs action or dismissed
  if (shouldHide) return null;

  // Build breakdown text: "3 comments · 2 messages" (ICU plural-aware)
  const breakdownParts: string[] = [];
  if (leadsCount > 0) {
    breakdownParts.push(tDash('smartBanner.leadsCount', { count: leadsCount }));
  }
  if (commentNeedsAction > 0) {
    breakdownParts.push(tDash('smartBanner.commentsCount', { count: commentNeedsAction }));
  }
  if (messageNeedsAction > 0) {
    breakdownParts.push(tDash('smartBanner.messagesCount', { count: messageNeedsAction }));
  }
  const breakdown = breakdownParts.join(' · ');

  // Items to show (max 5). The leads row is an extra aggregate row on top, so the
  // item cap is unchanged — leads never crowd out comment/message rows.
  const visibleItems = items.slice(0, 5);
  // `items` only ever carries comments+messages; leads have no per-lead rows here.
  const hasMore = commentNeedsAction + messageNeedsAction > 5;

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
        label: tDash('smartBanner.viewAllItems', { count: commentNeedsAction }),
        href: '/comments?filter=needs_action',
      });
    } else {
      viewAllLinks.push({
        label: tDash('smartBanner.viewAllItems', { count: messageNeedsAction }),
        href: '/messages?filter=needs_action',
      });
    }
  }

  const swipeBackground = (
    <div className="flex items-center justify-between px-6 bg-surface-100 dark:bg-surface-200 rounded-[1.5rem] h-full">
      <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      </div>
      <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      </div>
    </div>
  );

  return (
    <SwipeDismissWrapper
      onDismiss={handleDismiss}
      enabled={!shouldHide}
      className="mb-8 rounded-[1.5rem]"
      background={swipeBackground}
      peekStorageKey="smartBannerPeekSeen"
    >
      <Card
          className={clsx(
            'overflow-hidden transition-all duration-300',
            // Explicit utilities override Card's .card base class reliably
            // (alert-warning @apply class would depend on CSS source order)
            'bg-rose-50 text-rose-900 border border-rose-200',
            'dark:bg-rose-900 dark:text-rose-200 dark:border-rose-700/60',
            'border-s-4 border-s-rose-500'
          )}
          padding="none"
        >
          {/* Header row — toggle and dismiss are separate buttons in flex flow */}
          <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-5">
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0 text-start cursor-pointer select-none"
              aria-expanded={expanded}
              aria-label={tDash('smartBanner.needsAttention', { count: totalCount })}
            >
              {/* Warning icon */}
              <div className={clsx(
                'w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0',
                'bg-rose-200/50 text-rose-600 dark:bg-rose-800/40 dark:text-rose-400'
              )}>
                <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
              </div>

              {/* Title + breakdown */}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm sm:text-base leading-tight">
                  {tDash('smartBanner.needsAttention', { count: totalCount })}
                </p>
                {breakdown && (
                  <p className="text-xs sm:text-sm text-rose-700/80 dark:text-rose-400/70 mt-0.5 truncate">
                    {breakdown}
                  </p>
                )}
              </div>

              {/* Chevron toggle */}
              <div className="shrink-0 p-1">
                <ChevronDown
                  className={clsx(
                    'w-5 h-5 text-rose-600 dark:text-rose-400 transition-transform duration-300',
                    expanded && 'rotate-180'
                  )}
                />
              </div>
            </button>

            {/* Dismiss button */}
            <button
              type="button"
              onClick={handleDismiss}
              className="shrink-0 p-1.5 rounded-lg text-rose-600/60 dark:text-rose-400/60 hover:text-rose-800 dark:hover:text-rose-300 hover:bg-rose-200/40 dark:hover:bg-rose-700/30 transition-colors flex items-center justify-center"
              aria-label={tDash('smartBanner.dismissLabel')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Expandable item list */}
          <div
            style={{ maxHeight: expanded ? `${contentHeight}px` : '0px' }}
            className="transition-[max-height] duration-300 ease-in-out overflow-hidden"
          >
            <div ref={contentRef}>
              <div className="border-t border-rose-200/60 dark:border-rose-700/40">
                {/* Leads: ONE aggregate row, first — a customer who left a phone
                    number is the highest-intent item in this banner, and there is
                    no per-lead row to bury the rest. */}
                {leadsCount > 0 && (
                  <Link
                    href="/leads"
                    className="flex items-start gap-3 py-3 sm:py-3.5 px-4 sm:px-5 hover:bg-rose-100/50 dark:hover:bg-rose-800/30 transition-colors w-full text-start border-b border-rose-100/80 dark:border-rose-700/30"
                  >
                    <div className="shrink-0 mt-0.5">
                      <Phone className="w-4 h-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold truncate">
                          {tDash('smartBanner.leadsWaiting', { count: leadsCount })}
                        </span>
                        {/* The OLDEST wait, not the newest arrival: the point of
                            this row is "someone has been waiting too long", and a
                            19-lead queue whose newest arrived a minute ago would
                            otherwise read "1 minute ago". Same `waitingSince`
                            label the comment/message rows use for `earliestAt`.
                            Falls back to latestAt so a cached response from
                            before oldestAt existed still renders something. */}
                        {(leads?.oldestAt ?? leads?.latestAt) && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-rose-700/70 dark:text-rose-400/60">
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {tDash('smartBanner.waitingSince', {
                              time: formatRelativeTime((leads.oldestAt ?? leads.latestAt) as string, tTime),
                            })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-rose-800/70 dark:text-rose-300/60 truncate leading-relaxed">
                        {leads?.latestName
                          ? tDash('smartBanner.leadsLatest', { name: leads.latestName })
                          : tDash('smartBanner.leadsHint')}
                      </p>
                    </div>
                  </Link>
                )}

                {visibleItems.length > 0 ? (
                  <ul className="divide-y divide-rose-100/80 dark:divide-rose-700/30">
                    {visibleItems.map((item) => {
                      const ItemIcon = item.type === 'comment' ? MessageSquare : MessageCircle;
                      const snippet = item.text.length > 60
                        ? `${item.text.slice(0, 60)}…`
                        : item.text;
                      const reason = getReasonTag(item.flagReason, item.flagMeta, tFlagReason, tDash, locale);

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

                      // On a multi-channel workspace the channel REPLACES the type icon for
                      // message rows — the channel glyph already implies "message", so rendering
                      // both would say the same thing twice in a panel that is short on room.
                      // Comment rows keep MessageSquare (no per-row channel here), so the two
                      // row types still read apart.
                      const showChannelIcon = showChannelBadge && item.type === 'message' && item.platform;

                      const itemContent = (
                        <>
                          {/* Type icon — or the channel, which implies it */}
                          <div className="shrink-0 mt-0.5">
                            {showChannelIcon && item.platform ? (
                              <PlatformIcon
                                platform={item.platform}
                                size="sm"
                                tint="alert"
                                ariaLabel={tComments(PLATFORM_LABEL_KEYS[item.platform])}
                              />
                            ) : (
                              <ItemIcon className="w-4 h-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-semibold truncate">
                                {item.senderName || tc('unknownUser')}
                                {hasMultiple && (
                                  <span className="text-rose-700/70 dark:text-rose-400/60 font-bold"> ({item.messageCount})</span>
                                )}
                              </span>
                              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-rose-700/70 dark:text-rose-400/60">
                                <Clock className="w-3 h-3" aria-hidden="true" />
                                {displayTime}
                              </span>
                            </div>
                            <p className="text-xs text-rose-800/70 dark:text-rose-300/60 truncate leading-relaxed">
                              {snippet}
                            </p>
                            {/* Reason tag — only for notable reasons (not default SLA) */}
                            {showReasonTag && (
                              <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-200/60 text-rose-800/80 dark:bg-rose-800/40 dark:text-rose-300/80">
                                {reason}
                              </span>
                            )}
                          </div>
                        </>
                      );

                      const sharedClassName = "flex items-start gap-3 py-3 sm:py-3.5 px-4 sm:px-5 hover:bg-rose-100/50 dark:hover:bg-rose-800/30 transition-colors group w-full text-start";

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
                ) : (commentNeedsAction + messageNeedsAction) > 0 ? (
                  // Counts say there are comment/message items but they haven't
                  // arrived yet. Gated on that subtotal: a leads-ONLY banner has
                  // no items to wait for and must not sit on a loading line.
                  <div className="px-4 py-3 text-xs text-rose-700/70 dark:text-rose-400/60">
                    {tc('loading')}
                  </div>
                ) : null}

                {/* View all link(s) */}
                {viewAllLinks.length > 0 && (
                  <div className="flex items-center gap-4 px-4 py-3 sm:px-5 border-t border-rose-200/60 dark:border-rose-700/40">
                    {viewAllLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="text-xs sm:text-sm font-bold text-rose-700 hover:text-rose-900 dark:text-rose-400 dark:hover:text-rose-300 transition-colors"
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
    </SwipeDismissWrapper>
  );
}
