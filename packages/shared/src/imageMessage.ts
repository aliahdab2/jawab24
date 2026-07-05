/**
 * Image-message marker protocol.
 *
 * When a customer sends a photo in a DM, the backend's vision step stores and
 * enqueues the message body as "[Image: <description>]" / "[صورة: <description>]"
 * (backend i18n key `attachmentImageDescribed`). Three consumers must agree on
 * that format, so it is defined ONCE here:
 *   - backend formats it (i18n) — a drift-guard test asserts the templates match
 *   - ai-worker detects it to inject the IMAGE MESSAGE prompt directive
 *   - frontend strips it for display (icon replaces the marker)
 *
 * Bare placeholders ("[Image]" / "[صورة]", no description) are the legacy /
 * vision-failed form; they are matched separately.
 */

/** Matches "[Image: <description>]" / "[صورة: <description>]" and captures the description. */
export const IMAGE_MESSAGE_RE = /^\[(?:Image|صورة):\s*([\s\S]+)\]$/;

/** Matches the bare "[Image]" / "[صورة]" placeholder (no description). */
export const IMAGE_PLACEHOLDER_RE = /^\[(?:Image|صورة)\]$/;

/** True when the text is a described image-message body. */
export function isImageMessageBody(text: string): boolean {
    return IMAGE_MESSAGE_RE.test(text.trim());
}

/** The description inside an image-message body, or null when not one. */
export function extractImageDescription(text: string): string | null {
    const m = text.trim().match(IMAGE_MESSAGE_RE);
    return m ? m[1].trim() : null;
}

/** True when the text is an image message in either form (described or bare placeholder). */
export function isAnyImageMessage(text: string): boolean {
    const trimmed = text.trim();
    return IMAGE_MESSAGE_RE.test(trimmed) || IMAGE_PLACEHOLDER_RE.test(trimmed);
}
