import React, { useState } from 'react';
import clsx from 'clsx';
import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useClampOverflow } from '@/hooks';

interface PostContextCardProps {
  /** The post's text. */
  postMessage: string;
  /** Lines the post is clamped to while collapsed. Default 6. */
  clampLines?: 3 | 6;
  /** Action rendered at the trailing edge of the emerald header band (give it
   *  `ms-auto` to push it to the edge). */
  headerAction?: React.ReactNode;
  /** Content rendered below the post text inside the card (e.g. keyword chips).
   *  Provide its own top divider (`border-t`) to separate it from the post. */
  footer?: React.ReactNode;
}

/**
 * The labeled "POST" context card shown in the comment detail and Post Reply
 * setup modals: an emerald header band (Post Reply's identity colour — matches the
 * KeyRound title icon / keyword chips), a body clamped to a few lines with a
 * show-more / show-less toggle that appears only when the post overflows, and an
 * optional header action + footer. Single source of truth so both modals stay in
 * sync (colour, clamp behaviour, a11y).
 */
export function PostContextCard({ postMessage, clampLines = 6, headerAction, footer }: PostContextCardProps) {
  const t = useTranslations('comments');
  const [expanded, setExpanded] = useState(false);
  const { ref, isOverflowing } = useClampOverflow<HTMLParagraphElement>(postMessage, expanded);

  return (
    <div className="rounded-xl border border-theme-border bg-card overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-100 dark:border-emerald-800/50">
        <FileText className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          {t('postContext')}
        </span>
        {headerAction}
      </div>
      {/* Collapsed by default; expands in place (no nested scrollbox — that traps
          touch scroll in the mobile WebView). */}
      <p
        ref={ref}
        className={clsx(
          'px-3 pt-2.5 pb-2 text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed',
          !expanded && (clampLines === 3 ? 'line-clamp-3' : 'line-clamp-6'),
        )}
        dir="auto"
      >
        {postMessage}
      </p>
      {(isOverflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="block w-full px-3 pb-2.5 text-start text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
        >
          {expanded ? t('postShowLess') : t('postShowMore')}
        </button>
      )}
      {footer}
    </div>
  );
}
