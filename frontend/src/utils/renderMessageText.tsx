import type { ReactNode } from 'react';

/**
 * Regex matching international phone numbers: optional +, country code, digits/spaces/dashes.
 * Covers patterns like +966 50 123 4567, +46-700-224-720, 0501234567, etc.
 */
const PHONE_REGEX = /(\+?\d[\d\s\-]{6,}\d)/g;

/**
 * Image messages are stored as "[Image: <description>]" / "[صورة: <description>]"
 * — an explicit marker so the AI knows the customer sent a photo. In the UI that
 * marker is redundant with the image icon, so strip it and show just the
 * description. Bare placeholders (old "[Image]"/"[صورة]" with no description)
 * pass through unchanged.
 */
export function stripImageDescription(text: string): string {
  const m = text.match(/^\[[^\]:]+:\s*([\s\S]+)\]$/);
  return m ? m[1].trim() : text;
}

/**
 * Renders message text with embedded phone numbers wrapped in LTR spans.
 * Prevents RTL reordering of digits and the + sign in Arabic context.
 */
export function renderMessageText(text: string): ReactNode {
  const parts = text.split(PHONE_REGEX);
  if (parts.length === 1) return text;

  // split() with a capture group places matches at odd indices
  return parts.map((part, i) =>
    i % 2 === 1
      ? <span key={i} dir="ltr">{part}</span>
      : part
  );
}
