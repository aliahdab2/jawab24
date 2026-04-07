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
    AI_ENABLED: z.string().transform(val => val === 'true').default('false'),
    AI_CACHE_ENABLED: z.string().transform(val => val !== 'false').default('true'),

    // OpenAI (optional — required for auto-translation, KB embedding, and RAG)
    OPENAI_API_KEY: z.string().optional(),

    // RAG mode: off = static KB, shadow = run RAG but log only, on = full RAG
    RAG_MODE: z.enum(['off', 'shadow', 'on']).default('on'),

    // Shopify (optional — required for Shopify integration)
    SHOPIFY_API_KEY: z.string().optional(),
    SHOPIFY_API_SECRET: z.string().optional(),
    SHOPIFY_HOST_NAME: z.string().optional(),
    SHOPIFY_TOKEN_ENCRYPTION_KEY: z.string().min(32, 'SHOPIFY_TOKEN_ENCRYPTION_KEY must be at least 32 characters').optional(),

    // Salla (optional — required for Salla integration)
    SALLA_CLIENT_ID: z.string().optional(),
    SALLA_CLIENT_SECRET: z.string().optional(),
    SALLA_HOST_NAME: z.string().optional(),
    SALLA_WEBHOOK_SECRET: z.string().min(16, 'SALLA_WEBHOOK_SECRET must be at least 16 characters').optional(),
    SALLA_SCOPES: z.string().optional(),

    // Zid (optional — required for Zid integration)
    ZID_CLIENT_ID: z.string().optional(),
    ZID_CLIENT_SECRET: z.string().optional(),
    ZID_HOST_NAME: z.string().optional(),
    ZID_WEBHOOK_SECRET: z.string().min(16, 'ZID_WEBHOOK_SECRET must be at least 16 characters').optional(),
    ZID_SCOPES: z.string().optional(),

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

    // Admin emails (comma-separated list)
    ADMIN_EMAILS: z.string().optional(),

    // Cleanup endpoint secret token
    CLEANUP_SECRET_TOKEN: z.string().optional(),
}).refine(
    data => data.NODE_ENV !== 'production' || (!!data.REDIS_PASSWORD && data.REDIS_PASSWORD !== 'changeme_in_production'),
    {
        message: 'REDIS_PASSWORD must be set to a non-default value in production',
        path: ['REDIS_PASSWORD'],
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

