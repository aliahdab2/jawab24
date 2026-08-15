import { describe, it, expect } from 'vitest';
import { resolveNotificationTargetKey, NOTIFICATION_TARGET_KEYS } from '@jawab24/shared';
import { resolveNotificationRoute } from '../notificationUtils';

/**
 * Cross-boundary contract: the backend and the frontend both answer "which key
 * in notification.data names the row this notification is about?" — the backend
 * to build the Android tray tag (which pushes COLLAPSE onto which), the frontend
 * to route a tap (which screen OPENS).
 *
 * They agreed by coincidence, not by construction: two implementations, two
 * workspaces, no shared constant and no test crossing the boundary. If they
 * drift, a merchant taps the tray entry for one row and lands on another —
 * a symptom that points at neither function.
 *
 * `resolveNotificationRoute` deliberately keeps its own shape (it gates on
 * `data.type` so a comment-flavoured flagged_reply never routes to /messages,
 * and it owns the non-target fallbacks). Forcing it onto the shared resolver
 * would change routing semantics. So the contract is enforced HERE instead:
 * whenever the shared resolver names a target row, the route the frontend
 * builds must be about that same row.
 *
 * Payloads mirror PRODUCTION_PAYLOADS in backend/test/services/notifications.test.ts.
 * Keep the two in step — that table is the traced-from-call-sites source.
 */
const ROW_TARGETED_PAYLOADS: Array<{ type: string; data: Record<string, string> }> = [
    { type: 'flagged_reply', data: { messageId: 'm1', type: 'message', deepLink: '/messages?filter=flagged' } },
    { type: 'skipped_reply', data: { commentId: 'c1', type: 'comment', deepLink: '/comments?filter=flagged' } },
    { type: 'new_comment', data: { commentId: 'c1', type: 'comment', deepLink: '/comments?filter=flagged' } },
    { type: 'stale_comment', data: { commentId: 'c1' } },
    { type: 'stale_message', data: { type: 'message', messageId: 'm1', senderId: 's1', pageId: 'p1' } },
    { type: 'new_lead', data: { leadId: 'l1', pageId: 'p1', deepLink: '/leads?leadId=l1' } },
    { type: 'lead_reengaged', data: { leadId: 'l1', pageId: 'p1', deepLink: '/leads?leadId=l1' } },
];

describe('notification target contract (push tag ↔ deep-link route)', () => {
    it.each(ROW_TARGETED_PAYLOADS)('$type routes to the same row the push tag collapses on', ({ type, data }) => {
        const target = resolveNotificationTargetKey(data);
        expect(target, `${type} must name a target row`).toBeDefined();

        const route = resolveNotificationRoute(type, data);
        expect(route, `${type} must resolve a route`).not.toBeNull();
        // The route must carry the SAME id the tag is keyed on — not a different
        // row, and not a page-level fallback.
        expect(route, `${type}: route "${route}" does not target ${target!.id}`).toContain(target!.id);
    });

    it('never routes a page-scoped alert to a row', () => {
        // kb_gap / auto_reply_paused / post_reply_orphaned carry only a pageId, so
        // the shared resolver names no target and their pushes must keep stacking.
        for (const type of ['kb_gap', 'auto_reply_paused', 'post_reply_orphaned']) {
            const data = { pageId: 'p1', deepLink: '/pages#page-p1' };
            expect(resolveNotificationTargetKey(data), `${type} must name no target row`).toBeUndefined();
            // The route still works — it just points at the page, not a row.
            expect(resolveNotificationRoute(type, data)).toContain('p1');
        }
    });

    it('pins the key set both sides depend on', () => {
        // A new target key must be added to the shared constant, not to one side.
        expect([...NOTIFICATION_TARGET_KEYS]).toEqual(['messageId', 'commentId', 'leadId']);
    });
});
