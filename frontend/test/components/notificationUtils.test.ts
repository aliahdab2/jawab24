import { describe, it, expect } from 'vitest';
import {
  resolveNotificationRoute,
  groupNotifications,
  isGroup,
  formatBadgeCount,
  type Notification,
  type GroupedNotifications,
} from '@/components/ui/notificationUtils';

/** Build a notification with sensible defaults; input is assumed sorted newest-first. */
function notif(o: { id: string; type: string; createdAt: string; read?: boolean }): Notification {
  return {
    id: o.id,
    type: o.type,
    title: `title-${o.id}`,
    body: `body-${o.id}`,
    data: null,
    read: o.read ?? false,
    createdAt: o.createdAt,
  };
}

/** Fixed-clock helper (no Date.now) — returns an ISO timestamp `h` hours before a fixed noon. */
const hoursAgo = (h: number) => new Date(Date.UTC(2026, 0, 1, 12 - h, 0, 0)).toISOString();

describe('resolveNotificationRoute', () => {
  describe('comment/message deep links', () => {
    it('routes to /messages with messageId when data.type is message', () => {
      expect(resolveNotificationRoute('new_comment', { type: 'message', messageId: 'm-1' }))
        .toBe('/messages?messageId=m-1');
    });

    it('routes to /comments with commentId when data.type is not message', () => {
      expect(resolveNotificationRoute('new_comment', { type: 'comment', commentId: 'c-1' }))
        .toBe('/comments?commentId=c-1');
    });

    it('url-encodes ids', () => {
      expect(resolveNotificationRoute('new_comment', { type: 'comment', commentId: 'a/b c' }))
        .toBe('/comments?commentId=a%2Fb%20c');
    });
  });

  describe('flagged/skipped fallback without specific id', () => {
    it('routes flagged_reply to /comments?filter=flagged for comment items', () => {
      expect(resolveNotificationRoute('flagged_reply', { type: 'comment' }))
        .toBe('/comments?filter=flagged');
    });

    it('routes flagged_reply to /messages?filter=flagged for message items', () => {
      expect(resolveNotificationRoute('flagged_reply', { type: 'message' }))
        .toBe('/messages?filter=flagged');
    });

    it('routes skipped_reply the same way as flagged_reply', () => {
      expect(resolveNotificationRoute('skipped_reply', { type: 'message' }))
        .toBe('/messages?filter=flagged');
    });
  });

  describe('stale/new_comment fallback without specific id', () => {
    it('routes stale_message to /messages?filter=needs_action', () => {
      expect(resolveNotificationRoute('stale_message', undefined))
        .toBe('/messages?filter=needs_action');
    });

    it('routes stale_comment to /comments?filter=needs_action', () => {
      expect(resolveNotificationRoute('stale_comment', undefined))
        .toBe('/comments?filter=needs_action');
    });

    it('routes new_comment to /comments?filter=needs_action', () => {
      expect(resolveNotificationRoute('new_comment', undefined))
        .toBe('/comments?filter=needs_action');
    });
  });

  describe('non-comment types', () => {
    it('uses data.deepLink when present', () => {
      expect(resolveNotificationRoute('custom', { deepLink: '/settings/billing' }))
        .toBe('/settings/billing');
    });

    it('routes payment_failed to /pricing', () => {
      expect(resolveNotificationRoute('payment_failed', undefined)).toBe('/pricing');
    });

    it('routes subscription_expiring to /pricing', () => {
      expect(resolveNotificationRoute('subscription_expiring', undefined)).toBe('/pricing');
    });

    it('routes subscription_renewed to /pricing', () => {
      expect(resolveNotificationRoute('subscription_renewed', undefined)).toBe('/pricing');
    });

    it('routes trial_ending to /pricing', () => {
      expect(resolveNotificationRoute('trial_ending', undefined)).toBe('/pricing');
    });

    it('routes page_disconnected to /pages', () => {
      expect(resolveNotificationRoute('page_disconnected', undefined)).toBe('/pages');
    });

    it('routes kb_gap to /pages', () => {
      expect(resolveNotificationRoute('kb_gap', undefined)).toBe('/pages');
    });

    it('returns null for unknown types', () => {
      expect(resolveNotificationRoute('something_new', undefined)).toBeNull();
    });
  });

  it('prefers specific deep link over filter fallback', () => {
    expect(resolveNotificationRoute('flagged_reply', { type: 'message', messageId: 'm-9' }))
      .toBe('/messages?messageId=m-9');
  });
});

describe('groupNotifications', () => {
  it('returns an empty array when there are no notifications', () => {
    expect(groupNotifications([])).toEqual([]);
  });

  it('merges consecutive same-type notifications regardless of time gap (3h apart still group)', () => {
    // This is the headline behavior change: the old 1-hour window would have
    // split these into two identical-looking group headers.
    const items = [
      notif({ id: 'a', type: 'flagged_reply', createdAt: hoursAgo(0) }),
      notif({ id: 'b', type: 'flagged_reply', createdAt: hoursAgo(3) }),
    ];
    const result = groupNotifications(items);
    expect(result).toHaveLength(1);
    expect(isGroup(result[0])).toBe(true);
    expect((result[0] as GroupedNotifications).notifications).toHaveLength(2);
  });

  it('uses the newest (first) item\'s createdAt as latestTimestamp', () => {
    const items = [
      notif({ id: 'a', type: 'flagged_reply', createdAt: hoursAgo(0) }),
      notif({ id: 'b', type: 'flagged_reply', createdAt: hoursAgo(3) }),
    ];
    const [group] = groupNotifications(items) as GroupedNotifications[];
    expect(group.latestTimestamp).toBe(hoursAgo(0));
  });

  it('counts only unread items within a group', () => {
    const items = [
      notif({ id: 'a', type: 'flagged_reply', createdAt: hoursAgo(0), read: false }),
      notif({ id: 'b', type: 'flagged_reply', createdAt: hoursAgo(1), read: true }),
      notif({ id: 'c', type: 'flagged_reply', createdAt: hoursAgo(2), read: false }),
    ];
    const [group] = groupNotifications(items) as GroupedNotifications[];
    expect(group.notifications).toHaveLength(3);
    expect(group.unreadCount).toBe(2);
  });

  it('does not group across a different type in between (consecutive-only)', () => {
    const items = [
      notif({ id: 'a', type: 'flagged_reply', createdAt: hoursAgo(0) }),
      notif({ id: 'b', type: 'new_comment', createdAt: hoursAgo(1) }),
      notif({ id: 'c', type: 'flagged_reply', createdAt: hoursAgo(2) }),
    ];
    const result = groupNotifications(items);
    expect(result).toHaveLength(3);
    expect(result.every(item => !isGroup(item))).toBe(true);
  });

  it('never groups leads — each new_lead stays an individual card (preserves name + phone)', () => {
    const items = [
      notif({ id: 'a', type: 'new_lead', createdAt: hoursAgo(0) }),
      notif({ id: 'b', type: 'new_lead', createdAt: hoursAgo(0) }),
    ];
    const result = groupNotifications(items);
    expect(result).toHaveLength(2);
    expect(result.every(item => !isGroup(item))).toBe(true);
  });
});

describe('formatBadgeCount', () => {
  it('renders the number as-is at or below 99', () => {
    expect(formatBadgeCount(0)).toBe('0');
    expect(formatBadgeCount(5)).toBe('5');
    expect(formatBadgeCount(99)).toBe('99');
  });

  it('clamps to "99+" above 99', () => {
    expect(formatBadgeCount(100)).toBe('99+');
    expect(formatBadgeCount(5000)).toBe('99+');
  });
});
