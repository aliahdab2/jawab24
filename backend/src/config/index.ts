import dotenv from 'dotenv';
import path from 'path';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';

// Load environment variables from env/backend.env
dotenv.config({ path: path.resolve(__dirname, '../../../env/backend.env') });
// Also try local .env as fallback
dotenv.config();

export const config = {
    // Server
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',

    // Database
    databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/autoreply',

    // Redis
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
    },

    // Facebook (validated by validateEnv — no insecure fallbacks)
    facebook: {
        appId: process.env.FACEBOOK_APP_ID || '',
        appSecret: process.env.FACEBOOK_APP_SECRET || '',
        redirectUri: process.env.FACEBOOK_REDIRECT_URI || '',
        webhookVerifyToken: process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || '',
        graphApiVersion: process.env.FACEBOOK_GRAPH_API_VERSION || 'v18.0',
        tokenEncryptionKey: process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY || '',
    },

    // JWT (validated by validateEnv — no insecure fallbacks)
    jwt: {
        secret: process.env.JWT_SECRET || '',
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },

    // AI Service
    ai: {
        serviceUrl: process.env.AI_SERVICE_URL || 'http://localhost:3002',
        enabled: process.env.AI_ENABLED === 'true',
        cacheEnabled: process.env.AI_CACHE_ENABLED !== 'false',
        // Always use DEFAULT_AI_MODEL for cost efficiency - not configurable by users
        model: DEFAULT_AI_MODEL,
    },

    // OpenAI (for KB embeddings — same key as ai-worker)
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
    },

    // RAG mode: 'off' = static KB, 'shadow' = run RAG but use static KB, 'on' = full RAG
    ragMode: (process.env.RAG_MODE || 'on') as 'off' | 'shadow' | 'on',

    // Shopify App
    shopify: {
        apiKey: process.env.SHOPIFY_API_KEY || '',
        apiSecret: process.env.SHOPIFY_API_SECRET || '',
        scopes: 'read_products,read_content,read_orders,read_fulfillments,read_inventory',
        hostName: process.env.SHOPIFY_HOST_NAME || '',
        tokenEncryptionKey: process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '',
    },

    // Salla App (disabled until credentials are set)
    salla: {
        clientId: process.env.SALLA_CLIENT_ID || '',
        clientSecret: process.env.SALLA_CLIENT_SECRET || '',
        hostName: process.env.SALLA_HOST_NAME || '',
        webhookSecret: process.env.SALLA_WEBHOOK_SECRET || '',
        scopes: 'offline_access products.read_write settings.read webhooks.read_write orders.read_write',
    },

    // Zid App (disabled until credentials are set)
    zid: {
        clientId: process.env.ZID_CLIENT_ID || '',
        clientSecret: process.env.ZID_CLIENT_SECRET || '',
    },

    // Stripe Payment
    stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY || '',
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    },

    // Frontend URL
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',

    // Cookie secret (validated by validateEnv — no insecure fallback)
    cookieSecret: process.env.COOKIE_SECRET || '',

    // Webhook callback URL for Facebook subscription verification
    webhookCallbackUrl: process.env.WEBHOOK_CALLBACK_URL || 'https://jawab24.com/webhook',

    // Admin emails (comma-separated)
    adminEmails: (process.env.ADMIN_EMAILS || '').split(',').filter(Boolean),

    // Cleanup endpoint secret token
    cleanupSecretToken: process.env.CLEANUP_SECRET_TOKEN || '',

    // Demo Mode - allows testing without Facebook API approval
    demo: {
        enabled: process.env.DEMO_MODE_ENABLED === 'true',
        userFacebookId: 'demo_user_jawab24',
        userName: 'Demo User',
        userEmail: 'demo@jawab24.com',
    },

    // Circuit Breaker (ai-worker HTTP calls)
    circuitBreaker: {
        /** Consecutive failures before opening the circuit (default: 5) */
        failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10),
        /** Seconds to stay open before allowing one recovery probe (default: 30) */
        openDurationSeconds: parseInt(process.env.CIRCUIT_BREAKER_OPEN_DURATION_SECONDS || '30', 10),
    },
};
