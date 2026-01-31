import { test, expect } from '@playwright/test';

// Mock data
const MOCK_PLANS = [
  {
    id: 'plan_starter',
    slug: 'starter',
    name: 'Starter',
    price: 900,
    trialDays: 30,
    isActive: true,
    maxAiRepliesPerMonth: 100,
    maxPages: 1
  },
  {
    id: 'plan_business',
    slug: 'business',
    name: 'Business',
    price: 2900,
    trialDays: 0,
    isActive: true,
    maxAiRepliesPerMonth: 1000,
    maxPages: 5
  }
];

test.describe('Payment Flow', () => {

    test.beforeEach(async ({ page }) => {
        // Enable console logging from the browser
        page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));

        // Mock Plans API
        await page.route('**/api/plans**', async route => {
            console.log('Intercepted /api/plans request:', route.request().url());
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: MOCK_PLANS })
            });
        });

        // Mock Usage API (not authenticated)
        await page.route('**/api/subscription/usage**', async route => {
            console.log('Intercepted /api/subscription/usage request');
            await route.fulfill({ status: 401 });
        });
    });
    
  test('should redirect to login with correct planId when not authenticated', async ({ page }) => {
    // Mock Geo Check (Allowed)
    await page.route('**/api/geo/check*', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ sanctioned: false })
        });
    });

    // Navigate to pricing page
    await page.goto('/pricing');
    
    // Find a subscribe button for a paid plan.
    // Based on en.json: "Subscribe", "Start Free for 30 Days", "Get Started"
    const subscribeButtons = page.locator('button:has-text("Subscribe"), button:has-text("Start Free"), button:has-text("Get Started")');
    
    // Wait for at least one button
    await expect(subscribeButtons.first()).toBeVisible({ timeout: 10000 });
    
    // Click the first one (usually Starter)
    await subscribeButtons.first().click();
    
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
     // Mock Geo Check (Sanctioned)
     await page.route('**/api/geo/check*', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ sanctioned: true, countryCode: 'CU' })
        });
     });

     // Go to checkout directly
     await page.goto('/checkout?planId=plan_business');
     
     // Should see blocked message (match title from en.json)
     await expect(page.locator('text=Payments are not available in your region')).toBeVisible({ timeout: 10000 });
  });
});
