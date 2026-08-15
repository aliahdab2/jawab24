import type { Plan } from '@jawab24/shared';

/**
 * FALLBACK PLANS - Display Only
 *
 * ⚠️ CRITICAL: These plans are for DISPLAY PURPOSES ONLY
 * - Never use for billing calculations
 * - Always fetch real plans from API for checkout
 * - Backend validates all payments
 *
 * Last updated: 2026-07-09
 * Source: backend/src/config/plans.ts (seeded to DB by seed-plans.ts)
 */
export const FALLBACK_PLANS: Plan[] = [
    {
        id: 'fallback-starter',
        name: 'Starter',
        slug: 'starter',
        description: 'For small projects',
        price: 1500,
        yearlyPrice: 15000,
        // Display-only fallback: never claim yearly is purchasable when the API
        // (the authority on Stripe price config) is unreachable.
        yearlyAvailable: false,
        currency: 'USD',
        interval: 'month',
        maxPages: 1,
        maxAiRepliesPerMonth: 1500,
        maxProducts: null,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: false,
        showBranding: true,
        prioritySupport: false,
        trialDays: 0,
        regionalPricing: {},
        isActive: true,
        isPublic: true,
        isDefault: false,
        sortOrder: 1,
    },
    {
        id: 'fallback-business',
        name: 'Business',
        slug: 'business',
        description: 'For active stores',
        price: 3900,
        yearlyPrice: 39000,
        // Display-only fallback: never claim yearly is purchasable when the API
        // (the authority on Stripe price config) is unreachable.
        yearlyAvailable: false,
        currency: 'USD',
        interval: 'month',
        maxPages: 2,
        maxAiRepliesPerMonth: 4500,
        maxProducts: null,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: true,
        ecommerceEnabled: true,
        showBranding: false,
        prioritySupport: false,
        trialDays: 0,
        regionalPricing: {},
        isActive: true,
        isPublic: true,
        isDefault: true,
        sortOrder: 2,
    },
    {
        id: 'fallback-pro',
        name: 'Pro',
        slug: 'pro',
        description: 'For agencies',
        price: 7900,
        yearlyPrice: 79000,
        // Display-only fallback: never claim yearly is purchasable when the API
        // (the authority on Stripe price config) is unreachable.
        yearlyAvailable: false,
        currency: 'USD',
        interval: 'month',
        maxPages: 5,
        maxAiRepliesPerMonth: 10000,
        maxProducts: null,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: true,
        ecommerceEnabled: true,
        showBranding: false,
        prioritySupport: true,
        trialDays: 0,
        regionalPricing: {},
        isActive: true,
        isPublic: true,
        isDefault: false,
        sortOrder: 3,
    },
];
