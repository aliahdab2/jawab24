import { z } from 'zod';

/**
 * Environment Variable Validation Schema
 * Validates all required environment variables on startup
 */
const EnvSchema = z.object({
    // Server
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().default('3000').transform(Number),
    LOG_LEVEL: z.string().default('info'),

    // Database
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),

    // Redis
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.string().default('6379').transform(Number),
    REDIS_PASSWORD: z.string().optional(),
    // Validated below: required + non-default in production

    // Facebook
    FACEBOOK_APP_ID: z.string().min(1, 'FACEBOOK_APP_ID is required'),
    FACEBOOK_APP_SECRET: z.string().min(1, 'FACEBOOK_APP_SECRET is required'),
    FACEBOOK_REDIRECT_URI: z.string().url('FACEBOOK_REDIRECT_URI must be a valid URL'),
    FACEBOOK_WEBHOOK_VERIFY_TOKEN: z.string().min(1, 'FACEBOOK_WEBHOOK_VERIFY_TOKEN is required'),
    FACEBOOK_TOKEN_ENCRYPTION_KEY: z.string().min(32, 'FACEBOOK_TOKEN_ENCRYPTION_KEY must be at least 32 characters').optional(),

    // Cookie
    COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters for security'),

    // JWT
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for security'),
    JWT_EXPIRES_IN: z.string().default('7d'),

    // AI Service
    AI_SERVICE_URL: z.string().url('AI_SERVICE_URL must be a valid URL').default('http://localhost:3002'),
    // Shared secret sent on every backend → ai-worker call (X-AI-Worker-Secret header).
    // The worker gates its paid OpenAI/Anthropic endpoints on this. Must match the
    // worker's AI_WORKER_SECRET. Required in production (refine below); optional in dev.
    AI_WORKER_SECRET: z.string().optional(),
    AI_ENABLED: z.string().transform(val => val === 'true').default('false'),
    AI_CACHE_ENABLED: z.string().transform(val => val !== 'false').default('true'),
    // Kill-switch for self-service card top-ups. Defaults OFF so the feature +
    // its safety infra can deploy dark and be flipped on only after the Stripe
    // test-mode proof — and flipped back off instantly if anything misbehaves,
    // with no revert/redeploy.
    TOPUP_ENABLED: z.string().transform(val => val === 'true').default('false'),

    // OpenAI (optional — required for auto-translation, KB embedding, and RAG)
    OPENAI_API_KEY: z.string().optional(),

    // RAG mode: off = static KB, shadow = run RAG but log only, on = full RAG
    RAG_MODE: z.enum(['off', 'shadow', 'on']).default('on'),

    // Shopify (optional — required for Shopify integration)
    SHOPIFY_API_KEY: z.string().optional(),
    SHOPIFY_API_SECRET: z.string().optional(),
    SHOPIFY_HOST_NAME: z.string().optional(),
    SHOPIFY_TOKEN_ENCRYPTION_KEY: z.string().min(32, 'SHOPIFY_TOKEN_ENCRYPTION_KEY must be at least 32 characters').optional(),
    // Shared e-commerce token-at-rest key. ecommerceCrypto.ts reads
    // ECOMMERCE_TOKEN_ENCRYPTION_KEY first, falling back to SHOPIFY_TOKEN_ENCRYPTION_KEY,
    // so Salla/Zid/Shopify tokens all encrypt under whichever is set. Read from
    // process.env directly there; declared here so the prod guard below can see it.
    ECOMMERCE_TOKEN_ENCRYPTION_KEY: z.string().min(32, 'ECOMMERCE_TOKEN_ENCRYPTION_KEY must be at least 32 characters').optional(),

    // Salla (optional — required for Salla integration)
    SALLA_CLIENT_ID: z.string().optional(),
    SALLA_CLIENT_SECRET: z.string().optional(),
    SALLA_HOST_NAME: z.string().optional(),
    SALLA_WEBHOOK_SECRET: z.string().min(16, 'SALLA_WEBHOOK_SECRET must be at least 16 characters').optional(),
    // NOTE: SALLA_SCOPES / ZID_SCOPES were declared here for months but never read —
    // config/index.ts hardcodes both platforms' scope strings. Removed as dead env vars.

    // Zid (optional — required for Zid integration)
    ZID_CLIENT_ID: z.string().optional(),
    ZID_CLIENT_SECRET: z.string().optional(),
    // Zid Partner "Application ID" — webhook subscriptions' original_id field.
    ZID_APP_ID: z.string().optional(),
    ZID_HOST_NAME: z.string().optional(),
    ZID_WEBHOOK_SECRET: z.string().min(16, 'ZID_WEBHOOK_SECRET must be at least 16 characters').optional(),

    // Stripe (optional for development)
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // Frontend URL
    FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL').default('http://localhost:3001'),

    // Firebase (optional - push notifications require this)
    FIREBASE_SERVICE_ACCOUNT_KEY: z.string().optional(),

    // Webhook callback URL for Facebook subscription verification
    WEBHOOK_CALLBACK_URL: z.string().default('https://jawab24.com/webhook'),

    // NOTE: TRUSTED_GEO_HEADER_SOURCE is read directly from process.env in
    // middleware/geo.ts (allowed values: 'cloudflare' | 'vercel' | 'nginx').
    // Kept out of this schema so the middleware doesn't pull in the full
    // env-validation chain on import.

    // Admin emails (comma-separated list)
    ADMIN_EMAILS: z.string().optional(),
    SHAM_CASH_WALLET_NUMBER: z.string().optional(),

    // WhatsApp canary allowlist (comma-separated emails). Empty = open to all.
    WHATSAPP_ALLOWLIST: z.string().optional(),

    // Cleanup endpoint secret token
    CLEANUP_SECRET_TOKEN: z.string().optional(),

    // Resend — transactional email (lead digest, waitlist, future transactional)
    // Validated below: required in production (digest cron depends on it)
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().email('RESEND_FROM_EMAIL must be a valid email').default('info@jawab24.com'),
    RESEND_FROM_NAME: z.string().default('Jawab24'),
    // Validated like its sibling: this one is BOTH an SMTP reply_to and a
    // mailto: printed in every shell footer, so a typo is merchant-visible.
    // Optional by design — unset means replies keep going to RESEND_FROM_EMAIL.
    RESEND_REPLY_TO: z.union([z.string().email('RESEND_REPLY_TO must be a valid email'), z.literal('')]).optional(),
}).refine(
    data => data.NODE_ENV !== 'production' || (!!data.REDIS_PASSWORD && data.REDIS_PASSWORD !== 'changeme_in_production'),
    {
        message: 'REDIS_PASSWORD must be set to a non-default value in production',
        path: ['REDIS_PASSWORD'],
    },
).refine(
    // The Sham Cash rail's only reviewer notification goes to ADMIN_EMAILS; with
    // the wallet set and no address, merchants would pay into a queue nobody
    // opens. Fail at boot rather than discover it from a merchant's WhatsApp.
    data => !data.SHAM_CASH_WALLET_NUMBER || !!(data.ADMIN_EMAILS && data.ADMIN_EMAILS.trim()),
    {
        message: 'ADMIN_EMAILS must be set when SHAM_CASH_WALLET_NUMBER is set — the review queue has no other notification',
        path: ['ADMIN_EMAILS'],
    },
).refine(
    data => data.NODE_ENV !== 'production' || !!data.RESEND_API_KEY,
    {
        message: 'RESEND_API_KEY must be set in production — the lead digest cron cannot deliver emails without it',
        path: ['RESEND_API_KEY'],
    },
).refine(
    // When Stripe is configured in production, the webhook secret is mandatory.
    // Without it, stripe.webhooks.constructEvent throws on every event, the
    // webhook handler returns 400, Stripe treats it as permanent and stops
    // retrying — so payments (subscription invoices AND top-ups) get captured
    // but are never confirmed/credited. Fail fast at startup instead.
    data => data.NODE_ENV !== 'production' || !data.STRIPE_SECRET_KEY || !!data.STRIPE_WEBHOOK_SECRET,
    {
        message: 'STRIPE_WEBHOOK_SECRET must be set in production when STRIPE_SECRET_KEY is configured — webhook signature verification (and all payment confirmation/crediting) fails without it',
        path: ['STRIPE_WEBHOOK_SECRET'],
    },
).refine(
    // Page/user tokens in the prod DB are AES-GCM encrypted at rest (enc:v1:
    // rows). Without the key, maybeDecryptToken returns ciphertext as-is —
    // Facebook then rejects it with code 190 and every send/sync breaks, while
    // new writes silently revert to plaintext. Fail fast at startup instead.
    data => data.NODE_ENV !== 'production' || !!data.FACEBOOK_TOKEN_ENCRYPTION_KEY,
    {
        message: 'FACEBOOK_TOKEN_ENCRYPTION_KEY must be set in production — stored page/user tokens are encrypted at rest and unreadable without it',
        path: ['FACEBOOK_TOKEN_ENCRYPTION_KEY'],
    },
).refine(
    // Salla/Zid/Shopify access+refresh tokens are AES-256-GCM encrypted at rest via
    // ecommerceCrypto.ts, which reads ECOMMERCE_TOKEN_ENCRYPTION_KEY (falling back to
    // SHOPIFY_TOKEN_ENCRYPTION_KEY). Without either, the server boots fine but throws on
    // the first store connect/sync/token-refresh — a silent prod outage. Fail fast at
    // startup whenever any e-commerce integration is configured. (The Facebook guard
    // above covers a different key/path; this is the e-commerce equivalent.)
    data => data.NODE_ENV !== 'production'
        || !(data.SHOPIFY_API_KEY || data.SALLA_CLIENT_ID || data.ZID_CLIENT_ID)
        || !!data.ECOMMERCE_TOKEN_ENCRYPTION_KEY || !!data.SHOPIFY_TOKEN_ENCRYPTION_KEY,
    {
        message: 'ECOMMERCE_TOKEN_ENCRYPTION_KEY (or SHOPIFY_TOKEN_ENCRYPTION_KEY) must be set in production when a Shopify/Salla/Zid integration is configured — store tokens are encrypted at rest and unreadable without it',
        path: ['ECOMMERCE_TOKEN_ENCRYPTION_KEY'],
    },
).refine(
    // Salla webhook routes go live as soon as SALLA_CLIENT_ID is configured, but HMAC
    // verification needs SALLA_WEBHOOK_SECRET. Missing/typo'd → verifyWebhookHmac fails
    // closed → every Salla webhook (uninstall, order, product, cart) 401s silently. The
    // merchant looks connected while nothing flows. Fail fast at startup instead.
    data => data.NODE_ENV !== 'production' || !data.SALLA_CLIENT_ID || !!data.SALLA_WEBHOOK_SECRET,
    {
        message: 'SALLA_WEBHOOK_SECRET must be set in production when SALLA_CLIENT_ID is configured — Salla webhook HMAC verification fails closed without it (every webhook 401s)',
        path: ['SALLA_WEBHOOK_SECRET'],
    },
).refine(
    // Same coupling for Zid: routes live on ZID_CLIENT_ID, and webhook deliveries are
    // authenticated with Basic auth whose password is ZID_WEBHOOK_SECRET (Zid sends no
    // HMAC signature). Missing secret → verification fails closed → every webhook 401s.
    data => data.NODE_ENV !== 'production' || !data.ZID_CLIENT_ID || !!data.ZID_WEBHOOK_SECRET,
    {
        message: 'ZID_WEBHOOK_SECRET must be set in production when ZID_CLIENT_ID is configured — it is the Basic-auth password for Zid webhook deliveries; verification fails closed without it (every webhook 401s)',
        path: ['ZID_WEBHOOK_SECRET'],
    },
).refine(
    // Webhook REGISTRATION needs the Partner app id (original_id in the subscription
    // body). Without it every subscription attempt fails and the store silently gets
    // no webhooks — same failure mode the secret guard above closes for verification.
    data => data.NODE_ENV !== 'production' || !data.ZID_CLIENT_ID || !!data.ZID_APP_ID,
    {
        message: 'ZID_APP_ID must be set in production when ZID_CLIENT_ID is configured — Zid webhook subscriptions require it (original_id); registration silently fails without it',
        path: ['ZID_APP_ID'],
    },
).refine(
    // The ai-worker gates its paid OpenAI/Anthropic endpoints on this shared secret.
    // Without it the backend sends no auth header and the worker (in production, where
    // it mandates the secret) 401s every generation request — all AI replies break.
    // Must be >=16 chars to match the worker's own guard.
    data => data.NODE_ENV !== 'production' || (!!data.AI_WORKER_SECRET && data.AI_WORKER_SECRET.length >= 16),
    {
        message: 'AI_WORKER_SECRET must be set (>=16 chars) in production — it authenticates backend → ai-worker calls; without it the worker rejects every generation request',
        path: ['AI_WORKER_SECRET'],
    },
);

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validate environment variables
 * Throws error with clear message if validation fails
 */
export function validateEnv(): Env {
    try {
        return EnvSchema.parse(process.env);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const missingVars = error.errors.map(err => {
                const path = err.path.join('.');
                return `  - ${path}: ${err.message}`;
            }).join('\n');

            throw new Error(
                `❌ Environment variable validation failed:\n\n${missingVars}\n\n` +
                `Please check your env/backend.env file and ensure all required variables are set.`
            );
        }
        throw error;
    }
}

/**
 * Get validated environment variables
 * Safe to use after validateEnv() has been called
 */
export const env = validateEnv();

