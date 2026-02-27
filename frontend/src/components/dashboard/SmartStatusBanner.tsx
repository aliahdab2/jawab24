import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import {
  AlertTriangle,
  ChevronDown,
  MessageSquare,
  MessageCircle,
  Clock,
} from 'lucide-react';
import { Card } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';

// Unified item type for both comments and messages needing attention
export interface NeedsAttentionItem {
  id: string;
  type: 'comment' | 'message';
  senderName: string | null;
  text: string;
  createdAt: string | Date | null;
  flagReason: string | null;
  /** Deep link path, e.g. "/comments?id=abc" or "/messages?sender=xyz&page=123" */
  href: string;
}

interface SmartStatusBannerProps {
  commentNeedsAction: number;
  messageNeedsAction: number;
  items: NeedsAttentionItem[];
}

function getReasonTag(
  flagReason: string | null,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (flagReason) {
    const key = `flagReason.${flagReason}` as TranslationKey;
    const translated = t(key);
    // If the translation key exists (not returned as-is), use it
    if (translated !== key) return translated;
    // Fallback: format the raw reason
    return flagReason.replace(/_/g, ' ');
  }
  return t('dashboard.smartBanner.reasonNoReply' as TranslationKey);
}

function formatRelativeTime(
  date: string | Date | null,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return t('time.justNow' as TranslationKey);
  if (diffMin < 60) return t('time.minutesAgo' as TranslationKey, { count: diffMin });
  if (diffHr < 24) return t('time.hoursAgo' as TranslationKey, { count: diffHr });
  return t('time.daysAgo' as TranslationKey, { count: diffDay });
}

export function SmartStatusBanner({
  commentNeedsAction,
  messageNeedsAction,
  items,
}: SmartStatusBannerProps) {
  const { t } = useTranslation();
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

  // Build breakdown text: "3 comments · 2 messages"
  const breakdownParts: string[] = [];
  if (commentNeedsAction > 0) {
    breakdownParts.push(
      `${commentNeedsAction} ${t('comments.title' as TranslationKey).toLowerCase()}`
    );
  }
  if (messageNeedsAction > 0) {
    breakdownParts.push(
      `${messageNeedsAction} ${t('messages.title' as TranslationKey).toLowerCase()}`
    );
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
        label: t('dashboard.smartBanner.viewAllComments' as TranslationKey, { count: commentNeedsAction }),
        href: '/comments?filter=needs_action',
      });
      viewAllLinks.push({
        label: t('dashboard.smartBanner.viewAllMessages' as TranslationKey, { count: messageNeedsAction }),
        href: '/messages?filter=needs_action',
      });
    } else if (commentNeedsAction > 0) {
      viewAllLinks.push({
        label: t('dashboard.smartBanner.viewAllItems' as TranslationKey, { count: totalCount }),
        href: '/comments?filter=needs_action',
      });
    } else {
      viewAllLinks.push({
        label: t('dashboard.smartBanner.viewAllItems' as TranslationKey, { count: totalCount }),
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
      >
        {/* Warning icon */}
        <div className={clsx(
          'w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0',
          'bg-amber-100 text-amber-600 animate-pulse-attention'
        )}>
          <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>

        {/* Title + breakdown */}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm sm:text-base leading-tight">
            {t('dashboard.smartBanner.needsAttention' as TranslationKey, { count: totalCount })}
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
                  const reason = getReasonTag(item.flagReason, t);

                  return (
                    <li key={`${item.type}-${item.id}`}>
                      <Link
                        href={item.href}
                        className="flex items-start gap-3 px-4 py-3 sm:px-5 sm:py-3.5 hover:bg-amber-100/50 transition-colors group"
                      >
                        {/* Type icon */}
                        <div className="shrink-0 mt-0.5">
                          <ItemIcon className="w-4 h-4 text-amber-600" aria-hidden="true" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-semibold text-amber-900 truncate">
                              {item.senderName || t('common.unknownUser' as TranslationKey)}
                            </span>
                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700/70">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              {formatRelativeTime(item.createdAt, t)}
                            </span>
                          </div>
                          <p className="text-xs text-amber-800/70 truncate leading-relaxed">
                            {snippet}
                          </p>
                          {/* Reason tag */}
                          <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-200/60 text-amber-800/80">
                            {reason}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-4 py-3 text-xs text-amber-700/70">
                {t('common.loading' as TranslationKey)}
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
                    {link.label} →
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
