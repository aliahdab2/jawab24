import { redis } from '../../lib/redis';
import type { MessagePlatformAdapter, PlatformPage } from '../../interfaces';

/**
 * Per-conversation typing indicator lifecycle.
 *
 * Why this exists as its own module:
 *   Messenger/Instagram show "typing..." for up to 20s after a single `typing_on`
 *   call, or until the bot sends a message. If we fire `typing_on` before AI
 *   generation but then abort (spam/offensive/empty/delivery_failed) we strand
 *   the indicator for ~20s ("typing forever" bug). BullMQ retries make it worse
 *   — each retry re-arms the 20s timer.
 *
 * Contract:
 *   1. `show()` fires `typing_on` exactly once per platformMessageId across
 *      BullMQ retries (Redis SET NX EX guard).
 *   2. The reply pipeline tracks the return value and calls `clear()` on any
 *      abort path. The happy path skips `clear()` because the outgoing message
 *      itself dismisses the indicator.
 *
 * Cosmetic: all errors are swallowed — typing must never block the reply.
 */

const TYPING_DEDUP_TTL_SECONDS = 30;
const dedupKey = (pageId: string, platformMessageId: string) =>
    `typing:${pageId}:${platformMessageId}`;

/**
 * Show the typing indicator. Returns `true` if the indicator was actually
 * shown (caller must remember this and call `clear()` on abort paths).
 * Returns `false` if the adapter doesn't support typing, the dedup key was
 * already held (retry), or the upstream call failed.
 */
export async function show(
    adapter: MessagePlatformAdapter,
    page: PlatformPage,
    senderId: string,
    platformMessageId: string,
): Promise<boolean> {
    if (!adapter.sendTypingIndicator) return false;

    const acquired = await redis
        .set(dedupKey(page.id, platformMessageId), '1', 'EX', TYPING_DEDUP_TTL_SECONDS, 'NX')
        .catch(() => null);
    if (!acquired) return false;

    try {
        await adapter.sendTypingIndicator(page, senderId);
        return true;
    } catch {
        return false;
    }
}

/**
 * Clear the typing indicator. Fire-and-forget — never throws. Safe to call
 * when the adapter doesn't support typing_off (no-op).
 */
export function clear(
    adapter: MessagePlatformAdapter,
    page: PlatformPage,
    senderId: string,
): void {
    if (!adapter.sendTypingOff) return;
    adapter.sendTypingOff(page, senderId).catch(() => { /* cosmetic */ });
}
