import type { Plan } from '@jawab24/shared';

/**
 * FALLBACK PLANS - Display Only
 * 
 * ⚠️ CRITICAL: These plans are for DISPLAY PURPOSES ONLY
 * - Never use for billing calculations
 * - Always fetch real plans from API for checkout
 * - Backend validates all payments
 * 
 * Last updated: 2026-01-07
 * Source: Production API /plans endpoint
 */
export const FALLBACK_PLANS: Plan[] = [
    {
        id: 'fallback-starter',
        name: 'Starter',
        slug: 'starter',
        description: 'Auto-reply to your Facebook & Instagram page - 30 days free trial',
        price: 500, // $5.00
        currency: 'USD',
        interval: 'month',
        maxPages: 1,
        maxAiRepliesPerMonth: 200,
        maxTemplates: 3,
        maxRules: 2,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        shopifyEnabled: false,
        showBranding: true,
        prioritySupport: false,
        trialDays: 30,
        regionalPricing: {},
        isActive: true,
        isDefault: true,
        sortOrder: 0,
    },
    {
        id: 'fallback-business',
        name: 'Business',
        slug: 'business',
        description: 'Auto-reply to 3 Facebook/Instagram pages with unlimited templates',
        price: 3000, // $30.00
        currency: 'USD',
        interval: 'month',
        maxPages: 3,
        maxAiRepliesPerMonth: 1800,
        maxTemplates: null,
        maxRules: null,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        shopifyEnabled: true,
        showBranding: false,
        prioritySupport: false,
        trialDays: 0,
        regionalPricing: {},
        isActive: true,
        isDefault: false,
        sortOrder: 1,
    },
    {
        id: 'fallback-pro',
        name: 'Pro',
        slug: 'pro',
        description: 'Auto-reply to 10 Facebook/Instagram pages - for agencies',
        price: 7000, // $70.00
        currency: 'USD',
        interval: 'month',
        maxPages: 10,
        maxAiRepliesPerMonth: 9000,
        maxTemplates: null,
        maxRules: null,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        shopifyEnabled: true,
        showBranding: false,
        prioritySupport: false,
        trialDays: 0,
        regionalPricing: {},
        isActive: true,
        isDefault: false,
        sortOrder: 2,
    },
];
