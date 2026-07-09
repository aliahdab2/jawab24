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
        graphApiVersion: process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0',
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
        // Shared secret presented to the ai-worker on every call (see aiWorkerAuth.ts).
        workerSecret: process.env.AI_WORKER_SECRET || '',
        enabled: process.env.AI_ENABLED === 'true',
        cacheEnabled: process.env.AI_CACHE_ENABLED !== 'false',
        // Semantic (embedding-similarity) cache. Default ON. The layer is confirmed
        // dormant in prod (~0 real hits — the exact cache shadows it, thresholds are
        // strict, and high-value intents are skipped), yet every exact-cache MISS still
        // pays a text-embedding-3-small call (~$0.00002 + ~200ms) to probe it. Set
        // AI_SEMANTIC_CACHE_ENABLED=false to skip the probe entirely and go straight to
        // the OpenAI call — saves the embedding cost + latency with no impact on the
        // exact-cache path. Flip off ONLY after the cost breakdown confirms ~0 hits.
        semanticCacheEnabled: process.env.AI_SEMANTIC_CACHE_ENABLED !== 'false',
        // Always use DEFAULT_AI_MODEL for cost efficiency - not configurable by users
        model: DEFAULT_AI_MODEL,
        // Fallback model when primary provider (OpenAI) is unreachable
        fallbackModel: process.env.AI_FALLBACK_MODEL || 'claude-haiku-4-5-20251001',
        // Park-and-retry: when the AI is unavailable for a recoverable-but-not-instant
        // reason (OpenAI insufficient_quota, or the ai-worker circuit open), the reply
        // worker re-enqueues the job with a delay instead of flagging it needs_attention.
        // The message auto-replies once the AI recovers (e.g. OpenAI billing topped up).
        quotaParkSeconds: parseInt(process.env.AI_QUOTA_PARK_SECONDS || '900', 10),   // 15 min — quota recovers on top-up, not in seconds
        circuitParkSeconds: parseInt(process.env.AI_CIRCUIT_PARK_SECONDS || '60', 10), // ~2× circuit open window — skip the blip without long delay
        parkMaxRetries: parseInt(process.env.AI_PARK_MAX_RETRIES || '16', 10),         // bound total parking; after this, flag needs_attention
        quotaAlertCooldownSeconds: parseInt(process.env.AI_QUOTA_ALERT_COOLDOWN_SECONDS || '600', 10), // throttle the "top up OpenAI" alert (10 min)
    },

    // OpenAI (for KB embeddings — same key as ai-worker)
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
    },

    // Customer-image understanding (vision on DM images). Global kill switch —
    // default ON; set IMAGE_UNDERSTANDING_ENABLED=false to disable instantly
    // without a deploy. Per-merchant control is intentionally absent (matches
    // voice transcription); cost is bounded by the per-plan daily cap.
    imageUnderstanding: {
        enabled: process.env.IMAGE_UNDERSTANDING_ENABLED !== 'false',
    },

    // OpenAI ORG ADMIN key (sk-admin-…) — used ONLY by the read-only Costs/Usage
    // API that powers the admin AI Cost panel's billing snapshot. Distinct from the
    // project key above (project keys can't read org costs). Never sent to the
    // frontend, never logged; the snapshot cron no-ops when this is absent.
    openaiAdmin: {
        apiKey: process.env.OPENAI_ADMIN_API_KEY || '',
        // Map known api_key_ids to human labels so the panel can split prod vs eval/dev.
        prodKeyId: process.env.OPENAI_PROD_KEY_ID || '',
        evalKeyId: process.env.OPENAI_EVAL_KEY_ID || '',
    },

    // Proactive AI-spend monitoring: credit runway + early-warning alert thresholds
    // for the admin AI Cost panel. The org credit wallet is drained by ALL keys, so
    // burn/runway are computed from the OpenAI Costs API org total, not ai_usage_log.
    aiCostMonitoring: {
        enabled: process.env.AI_COST_MONITORING_ENABLED !== 'false',
        warnRunwayDays: parseInt(process.env.AI_COST_WARN_RUNWAY_DAYS || '7', 10),
        criticalRunwayDays: parseInt(process.env.AI_COST_CRITICAL_RUNWAY_DAYS || '3', 10),
        warnRemainingUsd: parseFloat(process.env.AI_COST_WARN_REMAINING_USD || '30'),
        // Throttle the proactive "credits low" email (24h) — separate from the
        // reactive insufficient_quota alert so neither suppresses the other.
        creditLowAlertCooldownSeconds: parseInt(process.env.AI_COST_ALERT_COOLDOWN_SECONDS || '86400', 10),
        rollingRateDays: parseInt(process.env.AI_COST_ROLLING_RATE_DAYS || '7', 10),
        // Spend-spike guardrail: alert when the latest complete day's org spend
        // exceeds `multiplier`× the trailing `baselineDays` average (and clears the
        // min-daily floor, so low-volume noise doesn't page). Catches runaway usage
        // — a bad prompt loop, abuse, a model misconfig — on day one.
        spendSpikeMultiplier: parseFloat(process.env.AI_COST_SPIKE_MULTIPLIER || '3'),
        spendSpikeMinDailyUsd: parseFloat(process.env.AI_COST_SPIKE_MIN_DAILY_USD || '5'),
        spendSpikeBaselineDays: parseInt(process.env.AI_COST_SPIKE_BASELINE_DAYS || '7', 10),
        spendSpikeAlertCooldownSeconds: parseInt(process.env.AI_COST_SPIKE_COOLDOWN_SECONDS || '86400', 10),
    },

    // Reply-queue health: per-job queue-wait sampling + backlog alert (the D-016
    // "sustained queue wait-time" scaling trigger). Breach = live waiting depth OR
    // recent p95 wait over threshold; two consecutive breaches fire a throttled
    // admin alert. The responses (raise REPLY_WORKER_CONCURRENCY, then split
    // queues) are manual by design — this only provides the signal.
    replyQueueHealth: {
        enabled: process.env.REPLY_QUEUE_HEALTH_ENABLED !== 'false',
        waitingThreshold: parseInt(process.env.REPLY_QUEUE_WAITING_THRESHOLD || '25', 10),
        waitP95ThresholdMs: parseInt(process.env.REPLY_QUEUE_WAIT_P95_THRESHOLD_MS || '15000', 10),
        // 1h — a queue incident needs faster re-alerting than the 24h cost cooldowns.
        alertCooldownSeconds: parseInt(process.env.REPLY_QUEUE_ALERT_COOLDOWN_SECONDS || '3600', 10),
        evalIntervalMs: parseInt(process.env.REPLY_QUEUE_EVAL_INTERVAL_MS || '60000', 10),
    },

    // RAG mode: 'off' = static KB, 'shadow' = run RAG but use static KB, 'on' = full RAG
    ragMode: (process.env.RAG_MODE || 'on') as 'off' | 'shadow' | 'on',

    // On-save operational-facts extraction (hours/phone/address → business_profile.merchant
    // as kb_extract, feeding the authoritative BUSINESS_INFO block):
    //   'off'    = never extract (default — safe until validated per merchant)
    //   'shadow' = extract + log the would-be change, write nothing (stability check)
    //   'on'     = extract + persist business_profile (fill-only-empty; never clobbers
    //              editor/fb_sync). Cache invalidation rides on the co-firing KB
    //              ingestion's kbActiveVersion activation — extraction never bumps it.
    opFactsExtract: (process.env.KB_OPFACTS_EXTRACT || 'off') as 'off' | 'shadow' | 'on',

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
        // Easy Mode post-install claim endpoints (GET /salla/store/pending, POST /salla/store/claim).
        // OFF by default: until the merchant-id ownership binding is hardened against Salla's
        // verified post-install redirect (live round-trip), these would let any logged-in user
        // claim a known merchant's pending install. Flip to true ONLY after that hardening +
        // switching the published app to Easy Mode in the Salla Partners portal.
        easyModeClaimEnabled: process.env.SALLA_EASY_MODE_CLAIM_ENABLED === 'true',
        // Easy Mode delivers tokens via the app.store.authorize webhook (server-to-server)
        // and RE-fires it to push refreshed tokens. When true, the proactive 6h pull-refresh
        // skips Easy-Mode stores so our OAuth refresh-token grant doesn't race Salla's push
        // (dual single-use-refresh-token rotation → brief invalid-token window) or falsely
        // mark a healthy webhook-managed store needs-reauth if the grant endpoint deviates.
        // OFF until the live Easy-Mode dry-run confirms Salla's push-refresh cadence.
        skipPullRefreshForEasyMode: process.env.SALLA_SKIP_PULL_REFRESH_EASY_MODE === 'true',
    },

    // Zid App (disabled until credentials are set)
    zid: {
        clientId: process.env.ZID_CLIENT_ID || '',
        clientSecret: process.env.ZID_CLIENT_SECRET || '',
        hostName: process.env.ZID_HOST_NAME || '',
        webhookSecret: process.env.ZID_WEBHOOK_SECRET || '',
        scopes: 'offline_access products.read orders.read webhooks.manage',
    },

    // Stripe Payment
    stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY || '',
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
        // Pinned billing portal configuration ID. Created once via the Stripe
        // Dashboard or the Stripe API; locks the portal to invoice history +
        // payment method updates only. Plan changes and cancellations go
        // through the app so DB stays in sync.
        billingPortalConfigId: process.env.STRIPE_BILLING_PORTAL_CONFIG_ID || '',
    },

    // Top-up packs — non-expiring AI reply credit purchases.
    // Prices in cents; overridable via env so they can be tuned without redeploy.
    // repliesAdded is the credit applied on successful purchase.
    topup: {
        // Kill-switch for self-service CARD top-ups (TOPUP_ENABLED). Off by
        // default: deploy the feature + safety infra dark, flip on after the
        // Stripe test-mode proof, flip off instantly to stop charging without a
        // redeploy. Gates create-topup-intent and the reconciliation sweep; the
        // manual WhatsApp flow is independent (gated by whatsappNumber).
        enabled: process.env.TOPUP_ENABLED === 'true',
        packs: {
            '5k': {
                repliesAdded: 5000,
                priceCents: Number(process.env.STRIPE_TOPUP_PACK_5K_CENTS) || 4900,
            },
            '10k': {
                repliesAdded: 10000,
                priceCents: Number(process.env.STRIPE_TOPUP_PACK_10K_CENTS) || 7900,
            },
        },
        currency: 'usd',
        // WhatsApp number for the manual purchase flow (MENA market — bank
        // transfer / USDT / cash buyers contact support via WhatsApp). E.164
        // format without leading + or spaces, e.g. "966500000000". Empty string
        // hides the manual flow from the UI.
        whatsappNumber: process.env.JAWAB24_SUPPORT_WHATSAPP || '',
    },

    // Frontend URL
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',

    // Cookie secret (validated by validateEnv — no insecure fallback)
    cookieSecret: process.env.COOKIE_SECRET || '',

    // Webhook callback URL for Facebook subscription verification
    webhookCallbackUrl: process.env.WEBHOOK_CALLBACK_URL || 'https://jawab24.com/webhook',

    // Admin emails (comma-separated)
    adminEmails: (process.env.ADMIN_EMAILS || '').split(',').filter(Boolean),

    // WhatsApp canary allowlist (comma-separated emails, case-insensitive).
    // EMPTY = WhatsApp connect open to everyone (full launch); non-empty =
    // only these accounts may connect a WhatsApp number (founder canary).
    // Independent of NEXT_PUBLIC_WHATSAPP_CONFIG_ID (which must also be set for
    // the Embedded Signup popup to function at all).
    whatsappAllowlist: (process.env.WHATSAPP_ALLOWLIST || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean),

    // Cleanup endpoint secret token
    cleanupSecretToken: process.env.CLEANUP_SECRET_TOKEN || '',

    // Demo Mode - allows testing without Facebook API approval
    demo: {
        enabled: process.env.DEMO_MODE_ENABLED === 'true',
        userFacebookId: 'demo_user_jawab24',
        userName: 'Demo User',
        userEmail: 'demo@jawab24.com',
    },

    // Phone OTP Authentication (feature flag — disabled until WhatsApp/SMS provider is configured)
    phoneAuthEnabled: process.env.PHONE_AUTH_ENABLED === 'true',

    // Vonage SMS — OTP delivery provider
    vonage: {
        apiKey: process.env.VONAGE_API_KEY || '',
        apiSecret: process.env.VONAGE_API_SECRET || '',
        senderId: process.env.VONAGE_SENDER_ID || 'Jawab24',
    },

    // Resend — transactional email (lead digest, waitlist campaigns, future transactional emails)
    // RESEND_API_KEY is required in production via src/utils/env.ts validation (fail-fast at boot).
    // In dev/test it may be empty; EmailService short-circuits (NODE_ENV==='development')
    // or captures a Sentry error and returns a typed failure.
    resend: {
        apiKey: process.env.RESEND_API_KEY || '',
        fromEmail: process.env.RESEND_FROM_EMAIL || 'info@jawab24.com',
        fromName: process.env.RESEND_FROM_NAME || 'Jawab24',
    },

    // Circuit Breaker (ai-worker HTTP calls)
    circuitBreaker: {
        /** Consecutive failures before opening the circuit (default: 5) */
        failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10),
        /** Seconds to stay open before allowing one recovery probe (default: 30) */
        openDurationSeconds: parseInt(process.env.CIRCUIT_BREAKER_OPEN_DURATION_SECONDS || '30', 10),
    },
};
