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
        // Entry rung below Starter. Post Reply is the product here — it is
        // unlimited on every plan and costs us nothing per send — and the 200
        // Smart Replies are a taster that drives the upgrade to Starter rather
        // than a usable AI allowance. Priced against the regional keyword-bot
        // incumbents, which sell a comparable AI-less base and charge for AI
        // separately as credits.
        //
        // No yearly price yet: `yearlyPrice: null` keeps the card monthly-only
        // and makes the backend refuse a yearly checkout, so the page can never
        // advertise an annual total that no Stripe price can charge.
        //
        // ⚠️ SHIPS INACTIVE ON PURPOSE. `stripe_price_id` is env-specific and set
        // by hand (see the file header) — the seed never writes it. An active,
        // public plan with no Stripe price renders a Subscribe button that
        // `resolveStripePriceForInterval` refuses with 400, on the public pricing
        // page. Order is therefore: deploy (row appears) → create the $8 monthly
        // price in Stripe and set `plans.stripe_price_id` → flip this to true in
        // a one-line commit. Flipping it in the DB alone will NOT hold: the seed
        // reconciles `isActive` from this file on every deploy.
        slug: 'basic',
        name: 'Basic',
        description: 'For post replies',
        price: 800,
        yearlyPrice: null,
        currency: 'USD',
        interval: 'month',
        maxPages: 1,
        maxAiRepliesPerMonth: 200,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: false,
        prioritySupport: false,
        trialDays: 0,
        isActive: false,
        isPublic: true,
        isDefault: false,
        sortOrder: 0,
    },
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
