/**
 * Helpers for rendering inbox/feed previews when the raw comment/message text
 * carries no useful information (e.g. "...", emoji-only, or an empty string on
 * an attachment-only message). Used by the dashboard feeds and — later — the
 * comments/messages pages, so the logic lives here rather than inline.
 */
import { VALID_AI_INTENTS } from '@jawab24/shared';

/**
 * True when the text is empty, whitespace, or made up solely of punctuation /
 * symbols / emoji — i.e. there's nothing meaningful to preview. A genuine
 * word in any script (incl. Arabic) is NOT low-signal.
 */
export function isLowSignalText(text: string | null | undefined): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  // Keep only letters/numbers from any script; if nothing remains it was just
  // punctuation/emoji (e.g. "...", "!!", "👍").
  const meaningful = trimmed.replace(/[^\p{L}\p{N}]/gu, '');
  return meaningful.length === 0;
}

/**
 * i18n key (in the global `common` namespace) for a normalized AI intent.
 * Returns null when there's no intent to label. Unknown intents fall through
 * to their raw key so a missing translation surfaces loudly rather than
 * silently showing nothing.
 */
export function intentLabelKey(intent: string | null | undefined): string | null {
  if (!intent) return null;
  const upper = intent.trim().toUpperCase();
  // Only label the canonical taxonomy — an unknown value falls through to the
  // neutral "no preview" line instead of rendering a raw key.
  return (VALID_AI_INTENTS as readonly string[]).includes(upper) ? `intentLabel.${upper}` : null;
}
