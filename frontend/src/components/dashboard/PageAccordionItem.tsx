import { useEffect, useRef } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import {
  ChevronRight,
  FileText,
  Instagram,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ChannelBadges } from '@/components/ui';
import { useChannelBadgeLabels } from '@/hooks';
import { formatConnectedDate } from '@/utils/dateUtils';
import { getPageAvatarUrl } from '@/utils/pageUrl';
import type { Page } from '@jawab24/shared';

interface PageAccordionItemProps {
  page: Page;
  isExpanded: boolean;
  onToggle: () => void;
  imgError: boolean;
  onImgError: () => void;
  pendingCount: number;
  animationDelay: number;
  /** Canary-aware WhatsApp visibility (isWhatsAppVisible at the page level) —
      gates the channel badges so the admin-only pilot doesn't leak to users. */
  whatsappVisible: boolean;
}

export function PageAccordionItem({
  page,
  isExpanded,
  onToggle,
  imgError,
  onImgError,
  pendingCount,
  animationDelay,
  whatsappVisible,
}: PageAccordionItemProps) {
  const tDash = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tComments = useTranslations('comments');
  const tPages = useTranslations('pages');
  const itemRef = useRef<HTMLDivElement>(null);
  // Track whether expansion was triggered by user click vs auto-expand on mount.
  // scrollIntoView should only fire on user-initiated toggles — auto-expanding
  // a single page on load would scroll past the "Welcome" header.
  const userToggled = useRef(false);

  useEffect(() => {
    if (isExpanded && itemRef.current && userToggled.current) {
      const timer = setTimeout(() => {
        itemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 320); // matches the CSS expand animation duration
      return () => clearTimeout(timer);
    }
  }, [isExpanded]);

  const handleToggle = () => {
    userToggled.current = true;
    onToggle();
  };

  const headerId = `page-header-${page.id}`;
  const panelId = `page-panel-${page.id}`;
  const isActive = page.autoReplyEnabled || page.instagramAutoReplyEnabled || page.whatsappAutoReplyEnabled;

  // Channel fingerprint labels: "<platform>: <enabled|disabled>"
  const badgeLabels = useChannelBadgeLabels(page);

  return (
    <div
      ref={itemRef}
      className="animate-slide-up"
      style={{ animationDelay: `${animationDelay}s` } as React.CSSProperties}
    >
      {/* Collapsed header — always visible */}
      <button
        type="button"
        id={headerId}
        onClick={handleToggle}
        className={clsx(
          'w-full flex items-center gap-4 p-4 sm:p-5 text-start transition-all cursor-pointer',
          isExpanded ? 'bg-brand-50/30' : 'hover:bg-brand-50/20'
        )}
        aria-expanded={isExpanded}
        aria-controls={panelId}
      >
        {/* Avatar */}
        <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden bg-brand-600 flex items-center justify-center transition-all group-hover:scale-105 shadow-sm">
          {getPageAvatarUrl(page) && !imgError ? (
            <img
              src={getPageAvatarUrl(page)!}
              alt={page.name}
              className="w-full h-full object-cover"
              onError={onImgError}
            />
          ) : (
            <FileText className="w-6 h-6 text-white" aria-hidden="true" />
          )}
        </div>

        {/* Page info */}
        <div className="flex-1 min-w-0 text-start">
          <p
            className={clsx(
              'font-bold line-clamp-2 transition-colors duration-300',
              isExpanded ? 'text-brand-600' : 'text-foreground'
            )}
            title={page.name}
          >
            {page.name}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {page.commentsCount || 0} {tDash('comments')}
            </span>
            {pendingCount > 0 && (
              <span className="text-xs font-semibold status-warning px-1.5 py-0.5 rounded whitespace-nowrap">
                {pendingCount} {tDash('pending')}
              </span>
            )}
          </div>
        </div>

        {/* Channel fingerprint — colored = replying, muted = connected but off.
            Canary-aware: no badges until WhatsApp is visible to THIS viewer (or
            this page already has a number — a live number is never hidden), so
            a dark deploy and the admin-only pilot both look like today. */}
        {(whatsappVisible || page.whatsappConnected) && (
          <ChannelBadges page={page} labels={badgeLabels} />
        )}

        {/* Chevron */}
        <ChevronRight
          className={clsx(
            'w-5 h-5 transition-transform duration-300 flex-shrink-0',
            isExpanded
              ? 'text-brand-500 ltr:rotate-90 rtl:-rotate-90'
              : 'text-icon-muted rtl:rotate-180'
          )}
          aria-hidden="true"
        />
      </button>

      {/* Expanded panel — CSS grid row animation (0fr → 1fr) */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        className={clsx(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-in-out',
          isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-theme-border bg-gradient-to-br from-emerald-50/60 to-surface-50/50 dark:from-emerald-950/30 dark:to-card px-4 sm:px-5 py-4">
            {/* Auto-paused banner — shown when Facebook persistently rejected our reply sends */}
            {page.autoPauseReason === 'send_rejected' && (
              <div
                className="mb-3 flex items-start gap-2 rounded-lg alert-warning px-3 py-2"
                role="alert"
              >
                <AlertTriangle
                  className="w-4 h-4 mt-0.5 flex-shrink-0"
                  aria-hidden="true"
                />
                <p className="text-xs leading-snug">
                  {tPages('autoPausedSendRejected')}
                </p>
              </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-card rounded-xl p-3 text-center shadow-sm">
                <p className="text-lg font-bold text-foreground leading-none">
                  {(page.commentsCount ?? 0).toLocaleString()}
                </p>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-1.5">
                  {tComments('title')}
                </p>
              </div>
              <div className="bg-card rounded-xl p-3 text-center shadow-sm">
                <p className="text-lg font-bold text-foreground leading-none">
                  {(page.repliesCount ?? 0).toLocaleString()}
                </p>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-1.5">
                  {tDash('autoReplies')}
                </p>
              </div>
              <div className="bg-card rounded-xl p-3 text-center shadow-sm">
                <p className="text-lg font-bold text-emerald-600 leading-none">
                  {page.replyRate ?? 0}%
                </p>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-1.5">
                  {tDash('replyRate')}
                </p>
              </div>
            </div>

            {/* Integration Rows */}
            <div className="mt-3 space-y-2">
              {/* Facebook */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-500" aria-hidden="true" />
                  <span className="text-[13px] font-medium text-muted-foreground">Facebook</span>
                </div>
                <span
                  className={clsx(
                    'text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap',
                    page.autoReplyEnabled
                      ? 'bg-emerald-500 text-white'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {page.autoReplyEnabled ? tc('active') : tc('inactive')}
                </span>
              </div>

              {/* Instagram */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Instagram className="w-4 h-4 text-pink-500" aria-hidden="true" />
                  <span className="text-[13px] font-medium text-muted-foreground">Instagram</span>
                </div>
                <span
                  className={clsx(
                    'text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap',
                    page.instagramAutoReplyEnabled
                      ? 'bg-emerald-500 text-white'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {page.instagramAutoReplyEnabled ? tc('active') : tc('inactive')}
                </span>
              </div>
            </div>

            {/* Status Row */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
                <div className={clsx(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  isActive ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'
                )} />
                <span className="text-xs font-bold text-muted-foreground whitespace-nowrap">
                  {tDash('pageAccordion.status')}:
                </span>
                <span className="text-xs font-bold text-muted-foreground whitespace-nowrap">
                  {isActive ? tc('active') : tc('inactive')}
                </span>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatConnectedDate(page.createdAt as string, tPages, tc('noData'))}
              </span>
            </div>

            {/* CTA Button */}
            <Link
              href={`/pages#page-${page.id}`}
              className="mt-3 flex items-center justify-center gap-2 w-full py-3 min-h-[44px] rounded-xl bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700 transition-colors"
            >
              {tDash('pageAccordion.managePage')}
              <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
