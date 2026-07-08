/**
 * Helpers for rendering inbox/feed previews. Used by the dashboard feeds (and,
 * later, the comments/messages pages), so the logic lives here rather than inline.
 */
import { VALID_AI_INTENTS } from '@jawab24/shared';

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
