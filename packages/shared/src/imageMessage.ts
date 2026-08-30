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

/**
 * Every described-image segment inside a customer turn, in order. Unlike
 * `extractImageDescription` this is not anchored: the reply pipeline consolidates
 * the messages of one debounce window into a single text, so a photo can sit
 * next to typed text or a second photo. A description containing `]` is cut at
 * it — the callers only ever WIDEN an allow-list with the result, so truncation
 * errs on the safe side.
 */
export function extractImageDescriptions(text: string): string[] {
    const out: string[] = [];
    const re = /\[(?:Image|صورة):\s*([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        out.push(m[1].trim());
    }
    return out;
}

/** True when the text is an image message in either form (described or bare placeholder). */
export function isAnyImageMessage(text: string): boolean {
    const trimmed = text.trim();
    return IMAGE_MESSAGE_RE.test(trimmed) || IMAGE_PLACEHOLDER_RE.test(trimmed);
}
