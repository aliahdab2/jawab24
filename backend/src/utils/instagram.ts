/**
 * Shared post / media utilities for Facebook and Instagram webhooks.
 *
 * Instagram shortcodes (e.g. "CxYz1AbC2De") are base64-encoded numeric media IDs.
 * The alphabet is: A-Z a-z 0-9 - _
 */

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Attachment types that represent a shared post or reel in DMs. */
const SHARED_POST_TYPES = new Set(['post', 'ig_post', 'reel', 'ig_reel']);

/** Check if an attachment type is a shared post or reel. */
export function isSharedPostType(type: string): boolean {
    return SHARED_POST_TYPES.has(type);
}

/**
 * Convert an Instagram shortcode to its numeric media ID.
 * Returns null if the shortcode contains invalid characters.
 */
export function shortcodeToMediaId(shortcode: string): string | null {
    let id = BigInt(0);
    for (const char of shortcode) {
        const idx = SHORTCODE_ALPHABET.indexOf(char);
        if (idx === -1) return null;
        id = id * BigInt(64) + BigInt(idx);
    }
    return id.toString();
}

/**
 * Extract a numeric post/media ID from a shared post URL or direct ID string.
 *
 * Priority:
 * 1. If a direct numeric `attachmentId` is provided (from webhook payload.id), use it.
 * 2. If the URL contains a numeric path segment (Facebook post URLs), extract it.
 * 3. If the URL is an Instagram permalink (/p/SHORTCODE/ or /reel/SHORTCODE/), decode the shortcode.
 *
 * Returns null if no ID can be extracted.
 */
export function extractPostId(url?: string, attachmentId?: string): string | null {
    // 1. Direct numeric ID from webhook payload
    if (attachmentId && /^\d+$/.test(attachmentId)) {
        return attachmentId;
    }

    if (!url) return null;

    // 2. Numeric ID in URL path (Facebook: /posts/123456, /123456/)
    const numericMatch = url.match(/\/(\d+)\/?(?:\?|$)/);
    if (numericMatch) {
        return numericMatch[1];
    }

    // 3. Instagram shortcode (/p/ABC123/ or /reel/ABC123/)
    const shortcodeMatch = url.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (shortcodeMatch) {
        return shortcodeToMediaId(shortcodeMatch[1]);
    }

    return null;
}
