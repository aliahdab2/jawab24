import clsx from 'clsx';
import { isLowSignalText } from '@/utils/feedPreview';

/**
 * Renders a comment/message preview line for the dashboard feeds. When the raw
 * text is meaningful it's shown as-is. When it's low-signal ("...", emoji-only,
 * empty attachment) it falls back to a human-readable AI-intent label, then a
 * neutral "no preview" line — so the feed never shows a useless "..." row.
 *
 * Note: it deliberately does NOT fall back to the post a comment was left on —
 * in the dashboard glance feed that surfaced the merchant's own post copy,
 * which reads like the customer's message and adds noise. The AI intent (what
 * the customer wants) is the useful signal; the post stays on the Comments page.
 *
 * Presentational only: callers resolve the i18n strings and pass them in.
 */
interface FeedSnippetProps {
  text: string | null | undefined;
  /** Resolved, human-readable AI-intent label (fallback when text is low-signal). */
  intentLabel?: string | null;
  /** Neutral fallback when nothing else is available. */
  noPreviewLabel: string;
  className?: string;
}

export function FeedSnippet({
  text,
  intentLabel,
  noPreviewLabel,
  className,
}: FeedSnippetProps) {
  if (!isLowSignalText(text)) {
    return (
      <p className={clsx('text-xs text-muted-foreground line-clamp-2 leading-relaxed break-words', className)}>
        {text}
      </p>
    );
  }

  // Fallback 1 — the AI-classified intent (e.g. "Question").
  if (intentLabel) {
    return (
      <span className={clsx('inline-flex items-center text-[11px] font-semibold text-muted-foreground bg-muted rounded-full px-2 py-0.5', className)}>
        {intentLabel}
      </span>
    );
  }

  // Fallback 2 — nothing to show.
  return (
    <p className={clsx('text-xs text-muted-foreground/70 italic', className)}>
      {noPreviewLabel}
    </p>
  );
}
