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
    yearlyPrice: number | null;
    currency: string;
    interval: 'month' | 'year';
    maxPages: number | null;
    maxAiRepliesPerMonth: number | null;
    facebookEnabled: boolean;
    instagramEnabled: boolean;
    whatsappEnabled: boolean;
    ecommerceEnabled: boolean;
    prioritySupport: boolean;
    trialDays: number;
    isActive: boolean;
    isPublic: boolean;
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
        maxAiRepliesPerMonth: 1500,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: false,
        prioritySupport: false,
        trialDays: 30,
        isActive: true,
        isPublic: true,
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
        maxAiRepliesPerMonth: 4500,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: true,
        ecommerceEnabled: true,
        prioritySupport: false,
        trialDays: 0,
        isActive: true,
        isPublic: true,
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
        whatsappEnabled: true,
        ecommerceEnabled: true,
        prioritySupport: true,
        trialDays: 0,
        isActive: true,
        isPublic: true,
        isDefault: false,
        sortOrder: 3,
    },
    {
        // Hidden high-volume plan — not shown on the public /pricing grid
        // (isPublic: false). Surfaced to Pro customers at their limit and
        // purchasable via the private /pricing/scale page or a direct link.
        slug: 'scale-20k',
        name: 'Scale 20K',
        description: 'High volume — for busy stores',
        price: 14900,
        yearlyPrice: null,
        currency: 'USD',
        interval: 'month',
        maxPages: 5,
        maxAiRepliesPerMonth: 20000,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: true,
        ecommerceEnabled: true,
        prioritySupport: true,
        trialDays: 0,
        isActive: true,
        isPublic: false,
        isDefault: false,
        sortOrder: 4,
    },
    {
        // Hidden high-volume plan — see scale-20k note above.
        slug: 'scale-30k',
        name: 'Scale 30K',
        description: 'High volume — for very busy stores',
        price: 19900,
        yearlyPrice: null,
        currency: 'USD',
        interval: 'month',
        maxPages: 5,
        maxAiRepliesPerMonth: 30000,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: true,
        ecommerceEnabled: true,
        prioritySupport: true,
        trialDays: 0,
        isActive: true,
        isPublic: false,
        isDefault: false,
        sortOrder: 5,
    },
];
