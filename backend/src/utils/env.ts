import { z } from 'zod';

/**
 * Environment Variable Validation Schema
 * Validates all required environment variables on startup
 */
const EnvSchema = z.object({
    // Server
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().default('3000').transform(Number),

    // Database
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),

    // Redis
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.string().default('6379').transform(Number),
    REDIS_PASSWORD: z.string().optional(),

    // Facebook
    FACEBOOK_APP_ID: z.string().min(1, 'FACEBOOK_APP_ID is required'),
    FACEBOOK_APP_SECRET: z.string().min(1, 'FACEBOOK_APP_SECRET is required'),
    FACEBOOK_REDIRECT_URI: z.string().url('FACEBOOK_REDIRECT_URI must be a valid URL'),
    FACEBOOK_WEBHOOK_VERIFY_TOKEN: z.string().min(1, 'FACEBOOK_WEBHOOK_VERIFY_TOKEN is required'),

    // Cookie
    COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters for security'),

    // JWT
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for security'),
    JWT_EXPIRES_IN: z.string().default('7d'),

    // AI Service
    AI_SERVICE_URL: z.string().url('AI_SERVICE_URL must be a valid URL').default('http://localhost:3002'),
    AI_ENABLED: z.string().transform(val => val === 'true').default('false'),
    AI_CACHE_ENABLED: z.string().transform(val => val !== 'false').default('true'),

    // Shopify (optional — required for Shopify integration)
    SHOPIFY_API_KEY: z.string().optional(),
    SHOPIFY_API_SECRET: z.string().optional(),
    SHOPIFY_HOST_NAME: z.string().optional(),

    // Stripe (optional for development)
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // Frontend URL
    FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL').default('http://localhost:3001'),

    // Firebase (optional - push notifications require this)
    FIREBASE_SERVICE_ACCOUNT_KEY: z.string().optional(),
});

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

