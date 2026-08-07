import clsx from 'clsx';
import { Image as ImageIcon } from 'lucide-react';
import { IMAGE_PLACEHOLDER_RE } from '@jawab24/shared';
import { renderMessageText, stripImageDescription } from '@/utils/renderMessageText';

/**
 * Renders a comment/message preview line for the dashboard feeds. Shows the raw
 * text whenever there is anything to show — including short, emoji- or
 * punctuation-only comments like "." or "❤️" (very common on "علّق بنقطة" /
 * "comment a dot for the link" posts). Merchants would rather see the actual
 * comment than a "no preview" placeholder. Only when the text is genuinely empty
 * (e.g. an attachment-only message with no caption) does it fall back to the
 * AI-intent label, then a neutral "no preview" line.
 *
 * Message text goes through `renderMessageText` — NOT rendered bare. A message
 * body is arbitrary customer text in an RTL page, so it needs the same two
 * treatments every other preview surface applies (MessageCard,
 * MessageDetailModal, CommentCard, CommentDetailModal):
 *   - phone numbers wrapped in LTR spans, or the bidi algorithm reorders the
 *     digit GROUPS right-to-left ("+963 472 924 935" → "935 924 472 963")
 *   - the "[صورة: …]" image marker stripped, with a leading icon standing in for
 *     it — the icon is what tells the merchant a photo arrived, so stripping the
 *     marker without it would lose that signal
 * Applied here rather than at the call sites so a future consumer cannot forget.
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
  const trimmed = text?.trim() ?? '';

  // A described image ("[صورة: <description>]") shows the description; the bare
  // legacy/vision-failed placeholder ("[صورة]") has nothing to show, so the icon
  // carries the meaning and the neutral label explains the missing text.
  const isBareImage = IMAGE_PLACEHOLDER_RE.test(trimmed);
  const body = isBareImage ? '' : stripImageDescription(trimmed);
  const isImage = isBareImage || body !== trimmed;

  // Anything with visible content — including a lone "." or emoji — is the real
  // comment and is shown as-is.
  if (body.length > 0 || isImage) {
    return (
      <p
        dir="auto"
        className={clsx('flex items-start gap-1 text-xs text-muted-foreground leading-relaxed', className)}
      >
        {isImage && (
          <ImageIcon className="w-3 h-3 flex-shrink-0 mt-0.5 text-icon-muted" aria-hidden="true" />
        )}
        <span className={clsx('line-clamp-2 break-words min-w-0', isBareImage && 'text-muted-foreground/70 italic')}>
          {body.length > 0 ? renderMessageText(body) : noPreviewLabel}
        </span>
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
