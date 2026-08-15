/**
 * Notification payload contract shared by the backend push path and the
 * frontend deep-link router.
 *
 * Both sides answer the same question — "which key in `notification.data`
 * names the row this notification is about?" — and they must not diverge:
 * the backend uses it to build the Android tray tag (which pushes collapse
 * onto which), the frontend uses it to route a tap (which screen opens).
 * If they disagree, a merchant taps the tray entry for one row and lands on
 * another, and neither function looks wrong in isolation.
 */

/**
 * Keys naming a notification's TARGET ROW, most-specific first.
 *
 * Order matters: a flagged/skipped reply carries a messageId or commentId AND
 * a pageId — the row is the target, not the page.
 *
 * ⚠️ `pageId` is deliberately NOT a target key. A page is a CONTAINER that
 * emits many distinct events, not a target: `kb_gap` payloads carry only
 * `{ pageId, intent, sampleQuery }` (services/kb/gap-detector.ts), so keying
 * on `pageId` would give every gap on a page the same tag and let "customers
 * keep asking about delivery" be silently overwritten by "customers keep
 * asking about prices". That is the exact harm the tag mechanism excludes
 * id-less types to avoid. `auto_reply_paused` and `post_reply_orphaned` carry
 * the same shape and the same risk.
 *
 * Types with no key from this list get no tag and keep stacking, which is the
 * safe default: a second, genuinely distinct event must never replace a first
 * the merchant has not seen.
 */
export const NOTIFICATION_TARGET_KEYS = ['messageId', 'commentId', 'leadId'] as const;

export type NotificationTargetKey = typeof NOTIFICATION_TARGET_KEYS[number];

/**
 * The target row id a notification payload names, or `undefined` when it names
 * none. Single source of truth for both the push tag and the deep-link route.
 */
export function resolveNotificationTargetKey(
    data: Record<string, unknown> | undefined,
): { key: NotificationTargetKey; id: string } | undefined {
    if (!data) return undefined;
    for (const key of NOTIFICATION_TARGET_KEYS) {
        const value = data[key];
        if (typeof value === 'string' && value.length > 0) return { key, id: value };
    }
    return undefined;
}
