import type { Plan } from '@jawab24/shared';

/**
 * FALLBACK PLANS - Display Only
 * 
 * ⚠️ CRITICAL: These plans are for DISPLAY PURPOSES ONLY
 * - Never use for billing calculations
 * - Always fetch real plans from API for checkout
 * - Backend validates all payments
 * 
 * Last updated: 2026-02-21
 * Source: Production API /plans endpoint
 */
export const FALLBACK_PLANS: Plan[] = [
    {
        id: 'fallback-starter',
        name: 'Starter',
        slug: 'starter',
        description: 'Auto-reply to your Facebook & Instagram page - 30 days free trial',
        price: 900, // $9.00
        currency: 'USD',
        interval: 'month',
        maxPages: 1,
        maxAiRepliesPerMonth: 300,
        maxTemplates: 3,
        maxRules: 2,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: false,
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
        price: 2900, // $29.00
        currency: 'USD',
        interval: 'month',
        maxPages: 3,
        maxAiRepliesPerMonth: 1500,
        maxTemplates: null,
        maxRules: null,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: true,
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
        price: 6900, // $69.00
        currency: 'USD',
        interval: 'month',
        maxPages: 10,
        maxAiRepliesPerMonth: 9000,
        maxTemplates: null,
        maxRules: null,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: true,
        showBranding: false,
        prioritySupport: false,
        trialDays: 0,
        regionalPricing: {},
        isActive: true,
        isDefault: false,
        sortOrder: 2,
    },
];
