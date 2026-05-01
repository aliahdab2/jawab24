/**
 * Plan definitions — single source of truth for subscription tiers.
 *
 * These are upserted into the `plans` table by `src/scripts/seed-plans.ts`,
 * which runs automatically after `db:migrate` on every deploy. To change a
 * plan, edit this file and ship — the seed will reconcile the DB on next deploy.
 *
 * Price in cents. Stripe price IDs live in the DB (set manually per env) and
 * are NOT overwritten by the seed — they're environment-specific secrets.
 */

export interface PlanSeed {
    slug: string;
    name: string;
    description: string;
    price: number;
    yearlyPrice: number;
    currency: string;
    interval: 'month' | 'year';
    maxPages: number | null;
    maxAiRepliesPerMonth: number | null;
    facebookEnabled: boolean;
    instagramEnabled: boolean;
    whatsappEnabled: boolean;
    ecommerceEnabled: boolean;
    showBranding: boolean;
    prioritySupport: boolean;
    trialDays: number;
    isActive: boolean;
    isDefault: boolean;
    sortOrder: number;
}

export const PLANS: PlanSeed[] = [
    {
        slug: 'starter',
        name: 'Starter',
        description: 'For small projects',
        price: 1500,
        yearlyPrice: 15000,
        currency: 'USD',
        interval: 'month',
        maxPages: 1,
        maxAiRepliesPerMonth: 1000,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: false,
        showBranding: true,
        prioritySupport: false,
        trialDays: 30,
        isActive: true,
        isDefault: true,
        sortOrder: 1,
    },
    {
        slug: 'business',
        name: 'Business',
        description: 'For active stores',
        price: 3900,
        yearlyPrice: 39000,
        currency: 'USD',
        interval: 'month',
        maxPages: 2,
        maxAiRepliesPerMonth: 3000,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: true,
        showBranding: false,
        prioritySupport: false,
        trialDays: 0,
        isActive: true,
        isDefault: false,
        sortOrder: 2,
    },
    {
        slug: 'pro',
        name: 'Pro',
        description: 'For agencies',
        price: 7900,
        yearlyPrice: 79000,
        currency: 'USD',
        interval: 'month',
        maxPages: 5,
        maxAiRepliesPerMonth: 10000,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: true,
        showBranding: false,
        prioritySupport: true,
        trialDays: 0,
        isActive: true,
        isDefault: false,
        sortOrder: 3,
    },
];
