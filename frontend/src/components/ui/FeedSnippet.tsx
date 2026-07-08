import clsx from 'clsx';

/**
 * Renders a comment/message preview line for the dashboard feeds. Shows the raw
 * text whenever there is anything to show — including short, emoji- or
 * punctuation-only comments like "." or "❤️" (very common on "علّق بنقطة" /
 * "comment a dot for the link" posts). Merchants would rather see the actual
 * comment than a "no preview" placeholder. Only when the text is genuinely empty
 * (e.g. an attachment-only message with no caption) does it fall back to the
 * AI-intent label, then a neutral "no preview" line.
 *
 * Presentational only: callers resolve the i18n strings and pass them in.
 */
interface FeedSnippetProps {
  text: string | null | undefined;
  /** Resolved, human-readable AI-intent label (fallback when text is empty). */
  intentLabel?: string | null;
  /** Neutral fallback when there is nothing at all to show. */
  noPreviewLabel: string;
  className?: string;
}

export function FeedSnippet({
  text,
  intentLabel,
  noPreviewLabel,
  className,
}: FeedSnippetProps) {
  // Anything with visible content — including a lone "." or emoji — is the real
  // comment and is shown as-is.
  if (text && text.trim().length > 0) {
    return (
      <p className={clsx('text-xs text-muted-foreground line-clamp-2 leading-relaxed break-words', className)}>
        {text}
      </p>
    );
  }

  // Fallback 1 — empty text but an AI-classified intent (e.g. "Question").
  if (intentLabel) {
    return (
      <span className={clsx('inline-flex items-center text-[11px] font-semibold text-muted-foreground bg-muted rounded-full px-2 py-0.5', className)}>
        {intentLabel}
      </span>
    );
  }

  // Fallback 2 — nothing to show (attachment-only / no caption).
  return (
    <p className={clsx('text-xs text-muted-foreground/70 italic', className)}>
      {noPreviewLabel}
    </p>
  );
}
