import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import {
  ChevronRight,
  FileText,
  Instagram,
  ArrowRight,
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatConnectedDate } from '@/utils/formatConnectedDate';
import type { Page } from '@jawab24/shared';

interface PageAccordionItemProps {
  page: Page;
  isExpanded: boolean;
  onToggle: () => void;
  imgError: boolean;
  onImgError: () => void;
  pendingCount: number;
  animationDelay: number;
}

export function PageAccordionItem({
  page,
  isExpanded,
  onToggle,
  imgError,
  onImgError,
  pendingCount,
  animationDelay,
}: PageAccordionItemProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [isExpanded]);

  // Scroll expanded item into view after animation
  useEffect(() => {
    if (isExpanded && itemRef.current) {
      const timer = setTimeout(() => {
        itemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 320);
      return () => clearTimeout(timer);
    }
  }, [isExpanded]);

  const headerId = `page-header-${page.id}`;
  const panelId = `page-panel-${page.id}`;
  const isActive = page.autoReplyEnabled || page.instagramAutoReplyEnabled;

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
        onClick={onToggle}
        className={clsx(
          'w-full flex items-center gap-4 p-4 sm:p-5 text-start transition-all cursor-pointer',
          isExpanded ? 'bg-brand-50/30' : 'hover:bg-brand-50/20'
        )}
        aria-expanded={isExpanded}
        aria-controls={panelId}
      >
        {/* Avatar */}
        <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden bg-brand-600 flex items-center justify-center transition-all group-hover:scale-105 shadow-sm">
          {!imgError ? (
            <img
              src={`https://graph.facebook.com/${page.facebookPageId}/picture?type=large`}
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
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs text-muted-foreground">
              {page.commentsCount || 0} {t('dashboard.comments')}
            </span>
            {pendingCount > 0 && (
              <span className="text-xs font-semibold status-warning px-1.5 py-0.5 rounded">
                {pendingCount} {t('dashboard.pending')}
              </span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <ChevronRight
          className={clsx(
            'w-5 h-5 transition-transform duration-300 flex-shrink-0',
            isExpanded
              ? 'text-brand-500 ltr:rotate-90 rtl:-rotate-90'
              : 'text-surface-300 rtl:rotate-180'
          )}
          aria-hidden="true"
        />
      </button>

      {/* Expanded panel */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        style={{ maxHeight: isExpanded ? `${contentHeight}px` : '0px' }}
        className={clsx(
          'transition-[max-height,opacity] duration-300 ease-in-out overflow-hidden',
          isExpanded ? 'opacity-100' : 'opacity-0'
        )}
      >
        <div ref={contentRef}>
          <div className="border-t border-theme-border bg-gradient-to-br from-emerald-50/60 to-surface-50/50 px-4 sm:px-5 py-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-card rounded-xl p-3 text-center shadow-sm">
                <p className="text-lg font-bold text-foreground leading-none">
                  {(page.commentsCount ?? 0).toLocaleString()}
                </p>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-1.5">
                  {t('comments.title')}
                </p>
              </div>
              <div className="bg-card rounded-xl p-3 text-center shadow-sm">
                <p className="text-lg font-bold text-foreground leading-none">
                  {(page.repliesCount ?? 0).toLocaleString()}
                </p>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-1.5">
                  {t('dashboard.autoReplies')}
                </p>
              </div>
              <div className="bg-card rounded-xl p-3 text-center shadow-sm">
                <p className="text-lg font-bold text-emerald-600 leading-none">
                  {page.replyRate ?? 0}%
                </p>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-1.5">
                  {t('dashboard.replyRate')}
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
                    'text-[11px] font-semibold px-2.5 py-0.5 rounded-full',
                    page.autoReplyEnabled
                      ? 'bg-emerald-500 text-white'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {page.autoReplyEnabled ? t('common.active') : t('common.inactive')}
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
                    'text-[11px] font-semibold px-2.5 py-0.5 rounded-full',
                    page.instagramAutoReplyEnabled
                      ? 'bg-emerald-500 text-white'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {page.instagramAutoReplyEnabled ? t('common.active') : t('common.inactive')}
                </span>
              </div>
            </div>

            {/* Status Row */}
            <div className="mt-2 flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <div className={clsx(
                  'w-2 h-2 rounded-full',
                  isActive ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'
                )} />
                <span className="text-xs font-bold text-muted-foreground">
                  {t('dashboard.pageAccordion.status' as TranslationKey)}:{' '}
                  {isActive ? t('common.active') : t('common.inactive')}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatConnectedDate(page.createdAt as string, t)}
              </span>
            </div>

            {/* CTA Button */}
            <Link
              href={`/pages#page-${page.id}`}
              className="mt-3 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700 transition-colors"
            >
              {t('dashboard.pageAccordion.managePage' as TranslationKey)}
              <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
