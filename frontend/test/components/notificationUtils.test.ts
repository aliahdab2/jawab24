import { describe, it, expect } from 'vitest';
import { resolveNotificationRoute } from '@/components/ui/notificationUtils';

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
