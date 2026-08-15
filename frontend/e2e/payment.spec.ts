import { test, expect } from '@playwright/test';

// Mock data - structured like FALLBACK_PLANS
const MOCK_PLANS = [
  {
    id: 'plan_starter',
    slug: 'starter',
    name: 'Starter',
    description: 'Starter plan description',
    price: 1500,
    currency: 'USD',
    interval: 'month',
    trialDays: 30,
    isActive: true,
    isDefault: true,
    maxAiRepliesPerMonth: 100,
    maxPages: 1,
    maxTemplates: 5,
    maxRules: 5,
    facebookEnabled: true,
    instagramEnabled: true,
    whatsappEnabled: false,
    prioritySupport: false,
    regionalPricing: {},
    sortOrder: 0
  },
  {
    id: 'plan_business',
    slug: 'business',
    name: 'Business',
    description: 'Business plan description',
    price: 2900,
    currency: 'USD',
    interval: 'month',
    trialDays: 0,
    isActive: true,
    isDefault: false,
    maxAiRepliesPerMonth: 1000,
    maxPages: 5,
    maxTemplates: null,
    maxRules: null,
    facebookEnabled: true,
    instagramEnabled: true,
    whatsappEnabled: false,
    prioritySupport: true,
    regionalPricing: {},
    sortOrder: 1
  }
];

test.describe('Payment Flow', () => {

    test.beforeEach(async ({ page }) => {
        page.on('pageerror', err => console.log(`PAGE ERROR: ${err}`));

        // Catch-all: return empty 200 for any unhandled API calls
        await page.route('**/api/**', async route => {
             await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });

        // 2. Mock Geo Check (Allowed by default)
        await page.route('**/api/geo/check*', async route => {
             await route.fulfill({
                 status: 200,
                 contentType: 'application/json',
                 body: JSON.stringify({ sanctioned: false })
             });
        });

        // 3. Mock Usage API (not authenticated)
        await page.route('**/api/subscription/usage**', async route => {
            await route.fulfill({ status: 401 });
        });

        // 4. Mock Plans API
        await page.route('**/api/plans**', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: MOCK_PLANS })
            });
        });
    });
    
  test('should redirect to login with correct planId when not authenticated', async ({ page }) => {
    // Navigate to pricing page (Force English)
    await page.goto('/en/pricing');
    
    // Find a subscribe button for a paid plan.
    // Based on en.json: "Subscribe", "Start Free for 30 Days", "Get Started"
    const subscribeButtons = page.locator('button:has-text("Subscribe"), button:has-text("Start Free"), button:has-text("Get Started")');
    
    // Wait for at least one button (scroll into view for mobile)
    const firstBtn = subscribeButtons.first();
    await firstBtn.waitFor({ state: 'attached', timeout: 10000 });
    await firstBtn.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(firstBtn).toBeVisible({ timeout: 5000 });

    // Click the first one (usually Starter)
    await firstBtn.click();
    
    // Verify we are redirected to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    
    // VERIFY THE FIX: Check that the redirect param is encoded and correct
    const url = page.url();
    expect(url).toContain('redirect=');
    
    // Decode the param to check it
    const searchParams = new URL(url).searchParams;
    const redirectParam = searchParams.get('redirect');
    
    expect(redirectParam).toBeTruthy();
    expect(redirectParam).toContain('/checkout');
    expect(redirectParam).toContain('planId=');
  });

  test('should block payment for sanctioned users (mocked)', async ({ page }) => {
     // Mock Geo Check (Sanctioned) - Override the default allowed mock
     await page.route('**/api/geo/check*', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ sanctioned: true, countryCode: 'CU' })
        });
     });

     // Go to checkout directly (Force English)
     await page.goto('/en/checkout?planId=plan_business');
     
     // Should see blocked message (match title from en.json)
     await expect(page.locator('text=Payments are not available in your region')).toBeVisible({ timeout: 10000 });
  });
});
