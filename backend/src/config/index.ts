import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from env/backend.env
dotenv.config({ path: path.resolve(__dirname, '../../../env/backend.env') });
// Also try local .env as fallback
dotenv.config();

export const config = {
    // Server
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

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
        // Always use gpt-4o-mini for cost efficiency - not configurable by users
        model: 'gpt-4o-mini',
    },

    // Shopify App
    shopify: {
        apiKey: process.env.SHOPIFY_API_KEY || '',
        apiSecret: process.env.SHOPIFY_API_SECRET || '',
        scopes: 'read_products,read_content',
        hostName: process.env.SHOPIFY_HOST_NAME || '',
        tokenEncryptionKey: process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '',
    },

    // Stripe Payment
    stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY || '',
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    },

    // Frontend URL
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',

    // Demo Mode - allows testing without Facebook API approval
    demo: {
        enabled: process.env.DEMO_MODE_ENABLED === 'true',
        userFacebookId: 'demo_user_jawab24',
        userName: 'Demo User',
        userEmail: 'demo@jawab24.com',
    },
};
