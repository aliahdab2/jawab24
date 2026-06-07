import clsx from 'clsx';
import { FileText } from 'lucide-react';
import { isLowSignalText } from '@/utils/feedPreview';

/**
 * Renders a comment/message preview line. When the raw text is meaningful it's
 * shown as-is. When it's low-signal ("...", emoji-only, empty attachment), it
 * falls back — in order — to the post it was left on (comments), then a
 * human-readable AI-intent label, then a neutral "no preview" line — so the
 * feed never shows a useless "..." row.
 *
 * Presentational only: callers resolve the i18n strings and pass them in.
 */
interface FeedSnippetProps {
  text: string | null | undefined;
  /** Comment-only: text of the post the comment is on (fallback context). */
  postContext?: string | null;
  /** Resolved, human-readable AI-intent label (fallback when no text/post). */
  intentLabel?: string | null;
  /** Prefix shown before the post context, e.g. "On post". */
  onPostLabel: string;
  /** Neutral fallback when nothing else is available. */
  noPreviewLabel: string;
  className?: string;
}

export function FeedSnippet({
  text,
  postContext,
  intentLabel,
  onPostLabel,
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

  // Fallback 1 — the post the comment was left on (most useful context).
  if (!isLowSignalText(postContext)) {
    return (
      <p
        dir="auto"
        className={clsx('flex items-start gap-1.5 text-xs text-muted-foreground italic line-clamp-2 leading-relaxed break-words', className)}
      >
        <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5 text-icon-muted" aria-hidden="true" />
        <span className="min-w-0">
          <span className="not-italic font-medium">{onPostLabel}:</span> {postContext}
        </span>
      </p>
    );
  }

  // Fallback 2 — the AI-classified intent (e.g. "Question").
  if (intentLabel) {
    return (
      <span className={clsx('inline-flex items-center text-[11px] font-semibold text-muted-foreground bg-muted rounded-full px-2 py-0.5', className)}>
        {intentLabel}
      </span>
    );
  }

  // Fallback 3 — nothing to show.
  return (
    <p className={clsx('text-xs text-muted-foreground/70 italic', className)}>
      {noPreviewLabel}
    </p>
  );
}
