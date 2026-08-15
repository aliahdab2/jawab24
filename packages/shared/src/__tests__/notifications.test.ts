import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TARGET_KEYS, resolveNotificationTargetKey } from '../notifications';

/**
 * This constant exists because two workspaces answer the same question about
 * the same payloads: the backend builds the Android tray tag from it (which
 * pushes collapse onto which) and the frontend routes a notification tap
 * (which screen opens). They previously encoded the precedence separately.
 */
describe('NOTIFICATION_TARGET_KEYS', () => {
    it('orders keys most-specific first', () => {
        expect([...NOTIFICATION_TARGET_KEYS]).toEqual(['messageId', 'commentId', 'leadId']);
    });

    it('excludes pageId — a page is a container that emits many distinct events', () => {
        // Including it would give every kb_gap on a page the same tag, letting a
        // second, genuinely distinct gap silently replace the first in the tray.
        expect(NOTIFICATION_TARGET_KEYS as readonly string[]).not.toContain('pageId');
    });
});

describe('resolveNotificationTargetKey', () => {
    it('returns undefined when there is no data at all', () => {
        expect(resolveNotificationTargetKey(undefined)).toBeUndefined();
        expect(resolveNotificationTargetKey({})).toBeUndefined();
    });

    it('picks the row id, ignoring the pageId sitting beside it', () => {
        expect(resolveNotificationTargetKey({ pageId: 'p1', messageId: 'm1' }))
            .toEqual({ key: 'messageId', id: 'm1' });
        expect(resolveNotificationTargetKey({ pageId: 'p1', commentId: 'c1' }))
            .toEqual({ key: 'commentId', id: 'c1' });
        expect(resolveNotificationTargetKey({ pageId: 'p1', leadId: 'l1' }))
            .toEqual({ key: 'leadId', id: 'l1' });
    });

    it('honours the precedence when several row ids are present', () => {
        expect(resolveNotificationTargetKey({ leadId: 'l1', commentId: 'c1', messageId: 'm1' }))
            .toEqual({ key: 'messageId', id: 'm1' });
    });

    it('returns undefined for a page-scoped payload', () => {
        // kb_gap / auto_reply_paused / post_reply_orphaned shape.
        expect(resolveNotificationTargetKey({ pageId: 'p1', intent: 'delivery' })).toBeUndefined();
    });

    it('rejects non-string and empty ids rather than tagging on junk', () => {
        expect(resolveNotificationTargetKey({ messageId: '' })).toBeUndefined();
        expect(resolveNotificationTargetKey({ messageId: 42 })).toBeUndefined();
        expect(resolveNotificationTargetKey({ messageId: null })).toBeUndefined();
        expect(resolveNotificationTargetKey({ messageId: undefined })).toBeUndefined();
        // Falls THROUGH a junk value to a valid later key rather than bailing.
        expect(resolveNotificationTargetKey({ messageId: 42, commentId: 'c1' }))
            .toEqual({ key: 'commentId', id: 'c1' });
    });
});
