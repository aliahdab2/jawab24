import { test, expect } from '@playwright/test';
import { t, tAr } from './i18n';

/**
 * Arming a Post Reply on a still-SCHEDULED Facebook post (PR #631).
 *
 * The API is mocked at the boundary: the Graph edges this feature reads
 * (`/{page-id}/scheduled_posts`, `/{post-id}?fields=is_published,...`) cannot produce a
 * real pending post from a test, so the contract they produce is the fixture. What this
 * spec locks is everything on our side of it — ordering, the two distinct metadata lines,
 * and the modal notice — in both locales.
 */

const MOCK_PAGES = [
  { id: 'page_1', facebookPageId: 'fb_123', name: 'Test Page', autoReplyEnabled: true, isConnected: true, commentsCount: 10 },
];

/** Pinned instant so the rendered date is deterministic (config pins the zone to
 *  Asia/Riyadh = UTC+3, so 09:00Z renders as 12:00 PM). */
const SCHEDULED_ISO = '2026-08-20T09:00:00.000Z';

/** One pending post + one published post: the two carry DIFFERENT metadata lines, which
 *  is the behaviour under test — a scheduled post has no publish date and no comments. */
const PUBLISHED_POSTS = {
  posts: [
    {
      platformPostId: 'fb_123_scheduled',
      source: 'facebook',
      message: 'Scheduled launch post',
      imageUrl: null,
      createdTime: null,
      commentsCount: null,
      hasTrigger: false,
      triggerType: null,
      isScheduled: true,
      scheduledPublishTime: SCHEDULED_ISO,
    },
    {
      platformPostId: 'fb_123_live',
      source: 'facebook',
      message: 'Already published post',
      imageUrl: null,
      createdTime: '2026-08-01T10:00:00.000Z',
      commentsCount: 12,
      hasTrigger: true,
      triggerType: 'keyword',
      isScheduled: false,
      scheduledPublishTime: null,
    },
  ],
  nextCursor: null,
  partial: false,
};

/** POST /posts/ensure — the server re-read the schedule from Graph on arm; this response
 *  is what drives the modal notice (not the picker's possibly-stale listing). */
const ENSURE_SCHEDULED = {
  id: 'post-internal-1',
  triggerKeyword: null,
  triggerReply: null,
  triggerType: 'keyword',
  triggerExcludeKeyword: null,
  triggerImageUrl: null,
  likeComment: false,
  tagCommenter: false,
  triggerButtonLabel: null,
  triggerButtonUrl: null,
  scheduledPublishTime: SCHEDULED_ISO,
};

test.describe('Post Reply on a scheduled post', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const json = (body: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

      if (url.includes('/published-posts')) return json(PUBLISHED_POSTS);
      if (url.includes('/posts/ensure')) return json(ENSURE_SCHEDULED);
      if (url.includes('/pages')) return json({ data: MOCK_PAGES });
      if (url.includes('/auth/profile')) return json({ id: 'u1', email: 'test@test.com', name: 'Test' });
      if (url.includes('/comments/stats')) return json({ total: 0, unreplied: 0, needsAttention: 0, repliedToday: 0, autoReplied: 0, resolved: 0, byMethod: {} });
      if (url.includes('/comments')) return json({ data: [], pagination: { nextCursor: null } });
      if (url.includes('/settings')) return json({ commentReplyMode: 'private', triggerImagesEnabled: true });
      if (url.includes('/subscription')) return json({ data: { subscription: { plan: { name: 'Business' }, status: 'active' }, aiReplies: { used: 0, limit: 1000, percentUsed: 0 }, pages: { used: 1, limit: 3 } } });
      return json({});
    });
  });

  for (const locale of ['en', 'ar'] as const) {
    const tr = locale === 'en' ? t : tAr;

    test(`picker lists it with its publish time, modal says the reply waits — ${locale}`, async ({ page }) => {
      // addInitScript, not evaluate-after-goto: the auth store hydrates before a late
      // write could land, leaving the guard redirecting to /login.
      await page.addInitScript((lang) => {
        localStorage.setItem(
          'auth-storage',
          JSON.stringify({
            state: { user: { id: 'u1', email: 'test@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
            version: 0,
          }),
        );
        localStorage.setItem(
          'ui-storage',
          JSON.stringify({ state: { sidebarOpen: true, language: lang, _hasHydrated: false, isOnboardingVisible: false }, version: 0 }),
        );
        localStorage.setItem('jawab24_onboarding_complete', 'true');
      }, locale);

      // ?openPostReply=true opens the picker directly (same param Settings → Manage uses).
      await page.goto(`/${locale}/comments?openPostReply=true`);
      await expect(page.getByText(tr('comments.postPickerTitle'))).toBeVisible();

      const scheduledRow = page.getByText('Scheduled launch post');
      await expect(scheduledRow).toBeVisible();

      // An ABSOLUTE date+time, never a relative "in 16 days" — formatMessageTime treats
      // every future date as "recent", which is why this path uses formatScheduledTime.
      // That also carries the UTC offset, so the merchant can reconcile it with what
      // Facebook's composer showed them.
      const scheduledLabel = locale === 'en' ? /Scheduled for/ : /مجدول للنشر/;
      await expect(page.getByText(scheduledLabel)).toContainText('2026');
      await expect(page.getByText(scheduledLabel)).toContainText('GMT');

      // The pending post sorts ABOVE the published one, and only the published one shows
      // a publish date + comment count.
      const rows = page.getByRole('listitem');
      await expect(rows.first()).toContainText('Scheduled launch post');
      await expect(rows.nth(1)).toContainText('12');

      // Arming it opens the trigger modal, which states the reply is waiting for publish.
      await scheduledRow.click();
      await expect(page.getByText(tr('comments.postTriggerCta'))).toBeVisible();
      const notice = locale === 'en' ? /starts working the moment the post is published/ : /يبدأ العمل لحظة نشر المنشور/;
      await expect(page.getByRole('note')).toHaveText(notice);
    });

    test(`no scheduled notice for an already-published post — ${locale}`, async ({ page }) => {
      // Same flow on the live post: the notice must be absent, or every trigger would
      // claim to be waiting for a publish that already happened.
      await page.route('**/api/**/posts/ensure', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...ENSURE_SCHEDULED, scheduledPublishTime: null }),
        }),
      );
      await page.addInitScript((lang) => {
        localStorage.setItem(
          'auth-storage',
          JSON.stringify({
            state: { user: { id: 'u1', email: 'test@test.com', name: 'Test' }, token: 'mock-token', fbToken: 'mock-fb', isAuthenticated: true },
            version: 0,
          }),
        );
        localStorage.setItem(
          'ui-storage',
          JSON.stringify({ state: { sidebarOpen: true, language: lang, _hasHydrated: false, isOnboardingVisible: false }, version: 0 }),
        );
        localStorage.setItem('jawab24_onboarding_complete', 'true');
      }, locale);

      await page.goto(`/${locale}/comments?openPostReply=true`);
      await page.getByText('Already published post').click();

      await expect(page.getByText(tr('comments.postTriggerCta'))).toBeVisible();
      await expect(page.getByRole('note')).toHaveCount(0);
    });
  }
});
