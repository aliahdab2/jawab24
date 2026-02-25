import { test, expect, devices } from '@playwright/test';
import path from 'path';

/**
 * Screenshot Script
 *
 * Captures full-page screenshots of every page in the application
 * in both desktop (webapp) and mobile viewports.
 *
 * Run: npx playwright test scripts/screenshots.spec.ts
 * Output: frontend/screenshots/
 */

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');

// ── Mock data (reused from existing E2E tests) ──────────────────────

const MOCK_COMMENT_STATS = {
  total: 42, replied: 30, unreplied: 12, needsAttention: 3,
  repliedToday: 5, replyRate: '71.4',
  byMethod: { ai: 20, template: 8, manual: 2 },
};

const MOCK_MESSAGE_STATS = { total: 25, replied: 18, pending: 7, needsAttention: 2 };

const MOCK_PAGES = [
  { id: 'page_1', facebookPageId: 'fb_123', name: 'My Business Page', autoReplyEnabled: true, instagramAutoReplyEnabled: false, commentsCount: 25, knowledgeBase: 'We sell electronics.' },
  { id: 'page_2', facebookPageId: 'fb_456', name: 'Second Page', autoReplyEnabled: false, instagramAutoReplyEnabled: false, commentsCount: 0, knowledgeBase: '' },
];

const MOCK_COMMENTS = {
  data: [
    { id: 'c1', postId: 'p1', message: 'What are your business hours?', fromName: 'Jane Doe', replied: true, replyText: 'We are open 9-5 daily.', replyMethod: 'ai', pageId: 'page_1', createdAt: new Date().toISOString() },
    { id: 'c2', postId: 'p2', message: 'How much does it cost?', fromName: 'John Smith', replied: false, replyText: null, replyMethod: null, pageId: 'page_1', createdAt: new Date().toISOString() },
  ],
  pagination: { nextCursor: null },
};

const MOCK_MESSAGES = {
  data: [
    { id: 'm1', senderName: 'Alice Brown', lastMessage: 'Hi, I need help with my order', replied: true, replyMethod: 'ai', pageId: 'page_1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'm2', senderName: 'Bob Wilson', lastMessage: 'Do you ship internationally?', replied: false, replyMethod: null, pageId: 'page_1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
  pagination: { nextCursor: null },
};

const MOCK_TEMPLATES = [
  { id: 'tpl_1', name: 'Welcome', translations: { en: 'Hello! Welcome to our page.', ar: 'مرحبا! أهلا بك في صفحتنا.' }, active: true },
  { id: 'tpl_2', name: 'Pricing', translations: { en: 'Our prices start at $5.', ar: 'أسعارنا تبدأ من 5 دولار.' }, active: true },
];

const MOCK_RULES = [
  { id: 'rule_1', name: 'Greeting Rule', keywords: ['hello', 'hi', 'مرحبا'], templateId: 'tpl_1', enabled: true, priority: 1 },
];

const MOCK_USAGE = {
  data: {
    subscription: { plan: { name: 'Starter' }, status: 'active', trialDaysRemaining: null },
    aiReplies: { used: 20, limit: 100, percentUsed: 20 },
    pages: { used: 2, limit: 3, percentUsed: 66 },
  },
};

const MOCK_SETTINGS = {
  dashboardLanguage: 'en', defaultReplyLanguage: 'auto', autoDetectLanguage: true,
  aiEnabled: true, aiModel: 'gpt-4.1-mini', notificationsEnabled: true, emailNotifications: false,
  webhookRetries: 3, commentReplyMode: 'auto', commentsAutoReply: true, messagesAutoReply: true,
  businessHoursOnly: false, businessHoursStart: '09:00', businessHoursEnd: '17:00',
  awayMessage: '', greetingMessage: '', replyDelay: 0,
  dualReplyConfig: { en: '', ar: '' }, commentEscalationMinutes: 60, messageEscalationMinutes: 30,
};

// ── Helpers ──────────────────────────────────────────────────────────

function setupAuth(page: import('@playwright/test').Page) {
  return page.addInitScript(() => {
    localStorage.setItem('auth-storage', JSON.stringify({
      state: { user: { id: 'user_1', email: 'test@test.com', name: 'Test User' }, token: 'mock-jwt-token', fbToken: 'mock-fb-token', isAuthenticated: true },
      version: 0,
    }));
    localStorage.setItem('ui-storage', JSON.stringify({
      state: { sidebarOpen: true, language: 'en', _hasHydrated: false, isOnboardingVisible: false },
      version: 0,
    }));
    localStorage.setItem('jawab24_onboarding_complete', 'true');
  });
}

function setupApiMocks(page: import('@playwright/test').Page) {
  return page.route('**/api/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/comments/stats')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENT_STATS) });
    }
    if (url.includes('/messages/stats')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MESSAGE_STATS) });
    }
    if (url.includes('/comments')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COMMENTS) });
    }
    if (url.includes('/messages')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MESSAGES) });
    }
    if (url.includes('/rules')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_RULES }) });
    }
    if (url.includes('/templates')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_TEMPLATES }) });
    }
    if (url.includes('/pages')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_PAGES }) });
    }
    if (url.includes('/subscription/usage')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USAGE) });
    }
    if (url.includes('/settings')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SETTINGS) });
    }
    if (url.includes('/auth/profile')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }) });
    }
    // Default: return empty 200
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function takeScreenshot(
  page: import('@playwright/test').Page,
  url: string,
  name: string,
  viewport: string,
  waitForSelector?: string
) {
  await page.goto(url);

  // Wait for content to render
  if (waitForSelector) {
    await page.locator(waitForSelector).first().waitFor({ state: 'visible', timeout: 20000 });
  }
  // Extra settle time for animations
  await page.waitForTimeout(1500);

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, viewport, `${name}.png`),
    fullPage: true,
  });
}

// ── Public pages (no auth needed) ───────────────────────────────────

const PUBLIC_PAGES = [
  { url: '/en', name: 'landing', waitFor: 'text=Smart 24/7 Sales Machine' },
  { url: '/en/login', name: 'login', waitFor: 'text=Login with Facebook' },
  { url: '/en/pricing', name: 'pricing', waitFor: 'h1' },
  { url: '/en/terms', name: 'terms', waitFor: 'h1' },
  { url: '/en/privacy', name: 'privacy', waitFor: 'h1' },
];

// ── Authenticated pages ─────────────────────────────────────────────

const AUTH_PAGES = [
  { url: '/en/dashboard', name: 'dashboard', waitFor: 'h1' },
  { url: '/en/comments', name: 'comments', waitFor: 'h1' },
  { url: '/en/messages', name: 'messages', waitFor: 'h1' },
  { url: '/en/pages', name: 'pages', waitFor: 'h1' },
  { url: '/en/templates', name: 'templates', waitFor: 'h1' },
  { url: '/en/rules', name: 'rules', waitFor: 'h1' },
  { url: '/en/settings', name: 'settings', waitFor: 'h1' },
];

// ── Desktop (webapp) screenshots ────────────────────────────────────

test.describe('Desktop Screenshots (1280x800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const p of PUBLIC_PAGES) {
    test(`${p.name}`, async ({ page }) => {
      await takeScreenshot(page, p.url, p.name, 'desktop', p.waitFor);
    });
  }

  for (const p of AUTH_PAGES) {
    test(`${p.name}`, async ({ page }) => {
      await setupAuth(page);
      await setupApiMocks(page);
      await takeScreenshot(page, p.url, p.name, 'desktop', p.waitFor);
    });
  }
});

// ── Mobile screenshots (iPhone 12 viewport) ─────────────────────────

test.describe('Mobile Screenshots (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const p of PUBLIC_PAGES) {
    test(`${p.name}`, async ({ page }) => {
      await takeScreenshot(page, p.url, p.name, 'mobile', p.waitFor);
    });
  }

  for (const p of AUTH_PAGES) {
    test(`${p.name}`, async ({ page }) => {
      await setupAuth(page);
      await setupApiMocks(page);
      await takeScreenshot(page, p.url, p.name, 'mobile', p.waitFor);
    });
  }
});
