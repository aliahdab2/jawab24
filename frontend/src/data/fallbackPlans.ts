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
        price: 1500, // $15.00/month
        yearlyPrice: 15000, // $150.00/year (10 months)
        currency: 'USD',
        interval: 'month',
        maxPages: 1,
        maxAiRepliesPerMonth: 400,
        maxTemplates: 5,
        maxRules: 7,
        maxProducts: null,
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
        description: 'Auto-reply to 2 Facebook/Instagram pages with unlimited templates',
        price: 3900, // $39.00/month
        yearlyPrice: 39000, // $390.00/year (10 months)
        currency: 'USD',
        interval: 'month',
        maxPages: 2,
        maxAiRepliesPerMonth: 3000,
        maxTemplates: null,
        maxRules: null,
        maxProducts: null,
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
        description: 'Auto-reply to 5 Facebook/Instagram pages - for agencies',
        price: 7900, // $79.00/month
        yearlyPrice: 79000, // $790.00/year (10 months)
        currency: 'USD',
        interval: 'month',
        maxPages: 5,
        maxAiRepliesPerMonth: 10000,
        maxTemplates: null,
        maxRules: null,
        maxProducts: null,
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
