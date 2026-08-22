import { describe, it, expect } from 'vitest';
import {
    resolveNotificationRoute,
    getNotificationStyle,
    DEFAULT_STYLE,
    ACCOUNT_HEALTH_TYPES,
} from './notificationUtils';

/**
 * A notification type is only half-shipped when the backend can send it: the
 * bell resolves the tap target, the icon, and the account-health pin from THIS
 * module, keyed by the raw type string. Miss a registration and the card
 * renders as a generic bell with no chevron and no action on tap — which is
 * exactly what happened to `auto_reply_paused` when it was added backend-first
 * (caught in self-review of PR #699, before it shipped).
 *
 * These cases pin the contract for the action-demanding types so the next one
 * added backend-first fails here instead of in a merchant's hands.
 */

describe('resolveNotificationRoute — types that demand an action must be tappable', () => {
    // Every type whose copy tells the merchant to go somewhere and do something.
    const ACTION_DEMANDING: ReadonlyArray<[type: string, route: string]> = [
        ['auto_reply_paused', '/pages'],
        ['page_disconnected', '/pages'],
        ['kb_gap', '/pages'],
        // Dead Instagram-direct credential — reconnect lives on /pages.
        ['instagram_reconnect_needed', '/pages'],
    ];

    it.each(ACTION_DEMANDING)('%s routes to %s', (type, route) => {
        expect(resolveNotificationRoute(type, undefined)).toBe(route);
    });

    it.each(ACTION_DEMANDING)('%s never resolves to null (unclickable card)', (type) => {
        // A null route makes NotificationBell skip the chevron AND no-op the
        // click — the merchant is told to act with no way to act.
        expect(resolveNotificationRoute(type, undefined)).not.toBeNull();
    });

    it('an explicit deepLink still wins over the type default', () => {
        expect(resolveNotificationRoute('auto_reply_paused', { deepLink: '/pages?pageId=abc' }))
            .toBe('/pages?pageId=abc');
    });

    it('an unknown type still resolves to null', () => {
        expect(resolveNotificationRoute('some_future_type', undefined)).toBeNull();
    });
});

describe('auto_reply_paused presentation', () => {
    it('has its own style rather than the generic bell fallback', () => {
        const style = getNotificationStyle('auto_reply_paused');
        expect(style).not.toBe(DEFAULT_STYLE);
        expect(style.icon).toBe(getNotificationStyle('page_disconnected').icon);
    });

    it('is red — the page is live and actively dropping customer messages', () => {
        const style = getNotificationStyle('auto_reply_paused');
        expect(style.hue).toBe('red');
        expect(style.className).toBe('notif-red');
    });

    it('is pinned as account health, like the billing pause it mirrors', () => {
        expect(ACCOUNT_HEALTH_TYPES.has('auto_reply_paused')).toBe(true);
        expect(ACCOUNT_HEALTH_TYPES.has('auto_reply_paused_billing')).toBe(true);
        expect(ACCOUNT_HEALTH_TYPES.has('instagram_reconnect_needed')).toBe(true);
    });
});

describe('auto_reply_paused_billing presentation', () => {
    it('has its own red billing style, not the generic bell fallback', () => {
        const style = getNotificationStyle('auto_reply_paused_billing');
        expect(style).not.toBe(DEFAULT_STYLE);
        // Same family as payment_failed — the same incident one step later.
        expect(style.icon).toBe(getNotificationStyle('payment_failed').icon);
        expect(style.hue).toBe('red');
        expect(style.className).toBe('notif-red');
    });

    it('routes via the backend-supplied deepLink', () => {
        expect(resolveNotificationRoute('auto_reply_paused_billing', { deepLink: '/settings' }))
            .toBe('/settings');
    });
});


describe('instagram_reconnect_needed — the dead Instagram-direct credential notice', () => {
    it('has its own style (not the generic bell) with the dead-channel red severity', () => {
        const style = getNotificationStyle('instagram_reconnect_needed');
        expect(style).not.toBe(DEFAULT_STYLE);
        expect(style.hue).toBe('red');
    });
});
