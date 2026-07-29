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

/** Key value once the platform has ACCEPTED the indicator, vs '1' = attempt claimed. */
const SENT = 'sent';

/**
 * Claim the single "show typing" attempt for this message and run `send`.
 *
 * The dedup claim is what lets two DIFFERENT call sites share one indicator without
 * double-arming Messenger's ~20s timer: whichever runs first wins and the other becomes
 * a no-op. Messenger claims it at webhook receipt (controllers/webhook.ts) so the
 * customer sees activity immediately; Instagram has no receipt hook, so its claim
 * happens later in the reply pipeline. Neither needs to know about the other.
 *
 * Returns `true` only when the platform accepted the call. Errors are swallowed —
 * typing is cosmetic and must never affect a reply.
 */
export async function showOnce(
    pageId: string,
    platformMessageId: string,
    send: () => Promise<void>,
): Promise<boolean> {
    const key = dedupKey(pageId, platformMessageId);
    const acquired = await redis
        .set(key, '1', 'EX', TYPING_DEDUP_TTL_SECONDS, 'NX')
        .catch(() => null);
    if (!acquired) return false;

    try {
        await send();
        // Upgrade the claim to "actually delivered" so an abort path can tell whether
        // there is anything to clear, without holding an in-process boolean. See
        // wasShown — the reply pipeline no longer awaits this call, so a returned
        // boolean would not reach it.
        await redis.set(key, SENT, 'EX', TYPING_DEDUP_TTL_SECONDS).catch(() => null);
        return true;
    } catch {
        return false;
    }
}

/**
 * Whether an indicator was actually delivered for this message.
 *
 * Redis, not a local flag, because the claim may have been made in a different process
 * (the webhook) from the one that has to clean up (the reply worker).
 */
export async function wasShown(pageId: string, platformMessageId: string): Promise<boolean> {
    // try/catch, not `.catch()` — this is called from the reply pipeline's `finally`, and a
    // throw there REPLACES whatever error was propagating. A `.catch()` on the result also
    // assumes redis.get returned a promise; when that assumption broke, transient-error
    // paths silently stopped rethrowing and BullMQ lost its retries. Never throw from here.
    try {
        return (await redis.get(dedupKey(pageId, platformMessageId))) === SENT;
    } catch {
        return false;
    }
}

/**
 * Adapter-driven form of {@link showOnce}. Used by the reply pipeline, which holds an
 * adapter rather than raw platform credentials.
 */
export async function show(
    adapter: MessagePlatformAdapter,
    page: PlatformPage,
    senderId: string,
    platformMessageId: string,
): Promise<boolean> {
    const sendTyping = adapter.sendTypingIndicator;
    if (!sendTyping) return false;
    return showOnce(page.id, platformMessageId, () => sendTyping.call(adapter, page, senderId));
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
