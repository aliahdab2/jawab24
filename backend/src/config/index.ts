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

    // Instagram API with Instagram Login (Instagram-DIRECT connect, no FB Page).
    // A SEPARATE Meta app product with its own app id/secret — not the Facebook
    // app credentials above. All three unset ⇒ the feature is dark (connect
    // endpoints 404 and the frontend option is hidden).
    instagram: {
        appId: process.env.INSTAGRAM_APP_ID || '',
        appSecret: process.env.INSTAGRAM_APP_SECRET || '',
        redirectUri: process.env.INSTAGRAM_APP_REDIRECT_URI || '',
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
        // v53 gender-bucketed DM exact cache (see services/genderMap.ts). Default ON.
        // Kill-switch: AI_GENDER_BUCKET_ENABLED=false instantly reverts DM cache keys
        // to pure per-name bucketing (v51 behavior) with no deploy — the learning map
        // keeps accumulating while off, so re-enabling is instant.
        genderBucketEnabled: process.env.AI_GENDER_BUCKET_ENABLED !== 'false',
        // Gender-neutral shared DM bucket (g:n) — companion to the v53 gender
        // bucket but fully independent of it (works with a cold map and even with
        // AI_GENDER_BUCKET_ENABLED=false). A reply the model certifies genderless
        // (gender:'unknown') and name-free is safe to share across ALL senders.
        // Kill-switch: AI_NEUTRAL_BUCKET_ENABLED=false reverts to v53 behavior
        // (per-gender/per-name buckets only) with no deploy; g:n entries become
        // unreachable while off — cold but safe.
        neutralBucketEnabled: process.env.AI_NEUTRAL_BUCKET_ENABLED !== 'false',
        // Save-side reply-cache quality gate (see services/cacheQualityGate.ts).
        // Replies the model itself marked weak (confidence 'low', or flagged
        // info_not_in_kb / price_not_in_kb / language_mismatch) are still served
        // to the customer but NOT saved to the exact or semantic cache — a weak
        // answer served once is a one-off; cached, it repeats for 30 days.
        // Default ON. Kill-switch: AI_QUALITY_GATE_ENABLED=false reverts to
        // cache-everything with no deploy; already-cached entries are unaffected
        // either way (the gate is save-side only).
        qualityGateEnabled: process.env.AI_QUALITY_GATE_ENABLED !== 'false',
        // Dual-variant shared DM cache (g:d): gendered replies store BOTH
        // addressee renderings (services/genderVariantTransform.ts) under ONE
        // key shared across all senders; the read side serves the rendering
        // matching the sender's map-known gender. Restores full pre-v51
        // cross-sender sharing while keeping gender-correct replies.
        // DEFAULT OFF — deliberately dark until the transform passes its
        // dialect-preservation eval; flip AI_DUAL_VARIANT_ENABLED=true after.
        dualVariantEnabled: process.env.AI_DUAL_VARIANT_ENABLED === 'true',
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

    // Post-send grounding verification (SYSTEM_ANALYSIS gap 13). A second model
    // call audits a sent reply against the merchant's Business Info and flags
    // unsupported assertions into Needs Attention. Detection only — it never
    // alters a reply. OFF by default: it adds a real per-reply cost
    // (~$0.001 on the gated subset), so it is enabled deliberately, and the
    // switch doubles as the instant rollback.
    groundingVerify: {
        enabled: process.env.GROUNDING_VERIFY_ENABLED === 'true',
        // 'shadow' (default): verdicts are recorded on the row's flag_meta only —
        // no flag_reason, no needs_attention, nothing merchant-visible. Data
        // accumulates for precision measurement while the merchant relationship
        // stays untouched (owner ruling 2026-07-28: no merchant contact, direct
        // or via UI, until a real fix exists). 'flag' switches on the visible
        // behaviour: flag chip + Needs Attention.
        mode: (process.env.GROUNDING_VERIFY_MODE === 'flag' ? 'flag' : 'shadow') as 'shadow' | 'flag',
        // Page allowlist. EMPTY = every page (once enabled); non-empty = only
        // these page UUIDs. A pilot belongs to one merchant, not the fleet:
        // precision has to be judged by someone who knows the business well
        // enough to say whether a flag is right, and one merchant's Needs
        // Attention is where that judgement actually happens.
        pageIds: (process.env.GROUNDING_VERIFY_PAGE_IDS || '')
            .split(',').map(id => id.trim()).filter(Boolean),
    },

    // «بوست اليوم» pilot — AI-suggested daily post (text + image) from Business
    // Info. No publishing; the merchant copies/downloads manually. OFF by
    // default: every generation is real OpenAI spend (~$0.006/image at
    // gpt-image-2 LOW, the owner-ruled quality; 'medium' at ~$0.05 is the
    // documented upgrade lever), so it is enabled deliberately and the switch
    // doubles as the instant rollback.
    postSuggestions: {
        enabled: process.env.POST_SUGGESTIONS_ENABLED === 'true',
        // WORKSPACE allowlist (owner ruling 2026-08-09: «just for
        // aliahdab@gmail.com workspace»). The default IS the founder's prod
        // workspace, so enabling the pilot needs only POST_SUGGESTIONS_ENABLED
        // — override the list for local dev or a wider rollout. EMPTY = every
        // workspace (the eventual GA path); the seed sweep never runs
        // fleet-wide regardless (see seedFirstPostSuggestions).
        workspaceIds: (process.env.POST_SUGGESTIONS_WORKSPACE_IDS
            || [
                'a0005407-92bf-473e-9368-013f14c57a7d', // Jawab24 founder workspace (prod)
                // First merchant tester (2026-08-10, owner-invited). Kept in the
                // DEFAULT rather than the server env so enabling a tester is one
                // reviewable deploy, not a manual env edit someone must remember
                // to mirror in the frontend allowlist.
                '9b6ba279-b569-4b45-b020-55b542dad5b6',
                // Second merchant tester (2026-08-11, owner-invited) — Waleed,
                // waleedraffas@gmail.com, one connected page.
                '30c90e2c-6ede-4e20-9b9e-9c5cd308e25d',
            ].join(','))
            .split(',').map(id => id.trim()).filter(Boolean),
        // ABSOLUTE generations/day/page cap (owner ruling 2026-08-09: 3, «ليس
        // أكثر») — the daily cron generation consumes 1 of these, leaving the
        // merchant at most 2 manual regenerates.
        dailyCapPerPage: parseInt(process.env.POST_SUGGESTIONS_DAILY_CAP || '3', 10),
    },

    // Reply-mode allowlist pilot (2026-08-15). Workspaces allowed to store
    // replyMode='info' (information-desk mode). Enforced at the WRITE path only
    // (settings + pages controllers) — the reply pipeline just reads whatever is
    // stored, so there is no hot-path env check. FAIL-CLOSED: an empty list
    // enables NOBODY (finding H4) — GA is deleting the gates in code, never
    // emptying or flipping an env var. Must stay in step with
    // NEXT_PUBLIC_REPLY_MODE_WORKSPACE_IDS in frontend/src/lib/featureFlags.ts
    // (frontend only hides the card; this list is the enforcement).
    replyMode: {
        // Presence check, NOT `||`: with `||` an operator who sets
        // REPLY_MODE_WORKSPACE_IDS='' to kill the pilot mid-incident gets the
        // built-in default back (''  is falsy), so there would be no env-only
        // kill switch and the "empty enables nobody" rule above would be
        // unreachable. An explicitly empty var now means exactly that: nobody.
        workspaceIds: ((process.env.REPLY_MODE_WORKSPACE_IDS !== undefined
            ? process.env.REPLY_MODE_WORKSPACE_IDS
            : [
                // InMedia agency (inmedia.sy@gmail.com) — the requesting merchant
                // (Shahin Resort + Shahin World). Kept in the DEFAULT rather than
                // the server env so the pilot is one reviewable deploy.
                'd06ed500-74ea-42ee-bff6-37bee2cf412a',
                // Founder workspace (aliahdab@gmail.com) — dogfooding during the
                // pilot (owner order 2026-08-17). Must stay in step with the
                // frontend default in featureFlags.ts (that one only hides the
                // UI; this list is the enforcement).
                'a0005407-92bf-473e-9368-013f14c57a7d',
            ].join(','))
        ).split(',').map(id => id.trim()).filter(Boolean),
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

    // KB re-ingest reconciler: self-heals pages whose vector chunks drifted from their KB text
    // (kb_active_version fell behind kb_version because a fire-and-forget ingest failed/lagged).
    // Default ON; kill-switch reverts to today's behavior. batchSize caps embedding cost per sweep.
    kbReingest: {
        enabled: process.env.KB_REINGEST_RECONCILE_ENABLED !== 'false',
        batchSize: parseInt(process.env.KB_REINGEST_BATCH_SIZE || '25', 10) || 25,
    },

    // Shopify App
    shopify: {
        apiKey: process.env.SHOPIFY_API_KEY || '',
        apiSecret: process.env.SHOPIFY_API_SECRET || '',
        scopes: 'read_products,read_content,read_orders,read_fulfillments,read_inventory',
        hostName: process.env.SHOPIFY_HOST_NAME || '',
        tokenEncryptionKey: process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '',
        // The app's URL handle on the Shopify App Store — the {app_handle} segment of
        // the merchant-facing plan-management deep link
        // (https://admin.shopify.com/store/{store}/charges/{app_handle}/pricing_plans).
        // Known once the listing exists; empty = frontend hides the deep link.
        appHandle: process.env.SHOPIFY_APP_HANDLE || '',
    },

    // Salla App (disabled until credentials are set)
    salla: {
        clientId: process.env.SALLA_CLIENT_ID || '',
        clientSecret: process.env.SALLA_CLIENT_SECRET || '',
        hostName: process.env.SALLA_HOST_NAME || '',
        webhookSecret: process.env.SALLA_WEBHOOK_SECRET || '',
        // ⚠️ `shipping.read` powers the List Shipments call in services/salla.ts — order
        // payloads never carry tracking (light response, see that file).
        //
        // ⛔ This string is NOT the grant. It is only read by `buildAuthUrl`, i.e. the OAuth
        // path used in dev / Custom Mode. The PUBLISHED app runs in Easy Mode, where Salla
        // drops the registered redirect URIs and the token arrives via `app.store.authorize`
        // (see controllers/salla.ts connectStore) — `buildAuthUrl` is never called and this
        // string has zero effect. For the published app the scope is granted SOLELY by the
        // app's configuration in Salla Partners. Keep the two in sync; the portal wins.
        // Stores that authorised before the scope was added keep their old grant until they
        // reconnect, regardless of mode.
        scopes: 'offline_access products.read_write settings.read webhooks.read_write orders.read_write shipping.read',
        // Easy Mode post-install claim endpoints (GET /salla/store/pending, POST /salla/store/claim).
        // OFF by default. Ownership binding = owner-email match (live 2026-07-18 dry-run proved
        // the OAuth authorize redirect is DEAD for Easy-Mode apps — redirect URIs unregistered):
        // at claim time the store's registered email (fetched live with the webhook-pushed token)
        // must equal the logged-in user's email. Flip to true only when the published app is
        // switched to Easy Mode in the Salla Partners portal (submission day).
        easyModeClaimEnabled: process.env.SALLA_EASY_MODE_CLAIM_ENABLED === 'true',
        // Public Salla App Store listing URL (known after approval). When set AND the Easy-Mode
        // claim flag is on, the merchant-facing "Connect Salla" action redirects here instead of
        // the OAuth authorize URL — which Salla 404s for Easy-Mode apps (no registered
        // redirect_uri), so the OAuth connect flow must not be offered for the published app.
        appStoreUrl: process.env.SALLA_APP_STORE_URL || '',
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
        // Zid Partner "Application ID" — the webhook subscription body's original_id
        // (a per-app identifier distinct from the OAuth client id).
        appId: process.env.ZID_APP_ID || '',
        hostName: process.env.ZID_HOST_NAME || '',
        // Basic-auth PASSWORD for webhook deliveries (username is the fixed
        // ZID_WEBHOOK_BASIC_USER constant) — Zid has no HMAC signature header.
        webhookSecret: process.env.ZID_WEBHOOK_SECRET || '',
        // The ONLY scope string Zid's docs show in an authorize URL
        // (docs.zid.sa/embedded-apps, Step 1) — required for POST
        // /v1/managers/embedded-apps-token, which powers direct merchant access
        // from the Zid dashboard iframe. Every other permission (Account, Orders,
        // Products, Webhooks…) is granted by the app's scope matrix in the
        // Partner Dashboard, not by this parameter — the previous value here was
        // four GUESSED names Zid never documented (part of the 2026-08-10
        // "OAuth does not meet our required standards" rejection).
        scopes: 'embedded_apps_tokens_write',
        // Where a Zid merchant manages the App Market subscription that bills
        // them for Jawab24. Unset by default ON PURPOSE: the App Market URL
        // shape is absent from Zid's docs and has never been observed on a live
        // install (EC3 blocks installing a Rejected app), and a guessed URL
        // would send paying merchants to a 404. See config/zidBilling.ts.
        appMarketUrl: process.env.ZID_APP_MARKET_URL || '',
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

    // Public origin+prefix that reaches THIS backend from the open internet. nginx maps
    // `/api/*` on the site origin onto the backend with the prefix stripped, so the default
    // derives from frontendUrl. Used for links embedded in messages that outlive the request
    // (e.g. the Post Reply image view link, which sits in Messenger threads forever).
    publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL || `${process.env.FRONTEND_URL || 'http://localhost:3001'}/api`,

    // GA4 Measurement Protocol — server-side conversion reporting (services/ga4.ts).
    //
    // Deliberately NOT validated by validateEnv: with either value empty the whole
    // integration no-ops, which is the correct posture for local dev and for any
    // deploy that has not been given credentials. Analytics must never be able to
    // fail a boot or a signup.
    //
    // measurementId is the SAME G-XXXXXXXX id the browser tag uses
    // (NEXT_PUBLIC_GA_ID); apiSecret is minted per data stream in
    // GA4 Admin → Data Streams → Measurement Protocol API secrets. It is a
    // write-only credential — it can send events, it cannot read reports.
    ga4: {
        measurementId: process.env.GA4_MEASUREMENT_ID || '',
        apiSecret: process.env.GA4_API_SECRET || '',
    },

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

    // WhatsApp redirect connect flow (full-page Embedded Signup — no popup).
    // whatsappConfigId: the SAME public Configuration ID the frontend inlines
    // as NEXT_PUBLIC_WHATSAPP_CONFIG_ID; the backend needs it to build the
    // OAuth dialog URL server-side. whatsappConnectRedirect: rollout flag —
    // when false the /auth/whatsapp/* routes 404 and the popup flow remains
    // the only path (instant rollback is flipping this off).
    whatsappConfigId: process.env.WHATSAPP_CONFIG_ID || '',
    whatsappConnectRedirect: process.env.WHATSAPP_CONNECT_REDIRECT === 'true',

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

    // Object storage (S3-compatible) — merchant-uploaded images (Post Reply trigger
    // images today; reply-type-agnostic for future reuse). Provider-agnostic: point
    // the same code at Backblaze B2 / Cloudflare R2 / AWS S3 / self-hosted MinIO via
    // env — see backend/docs/OBJECT_STORAGE.md. Feature stays OFF (isConfigured=false)
    // until every required var is set; the rest of the app boots without it.
    //   - endpoint EMPTY  → real AWS S3 (region-based addressing)
    //   - endpoint SET    → B2/R2/MinIO (forces path-style addressing internally)
    objectStorage: {
        endpoint: process.env.S3_ENDPOINT || '',
        region: process.env.S3_REGION || 'us-east-1',
        bucket: process.env.S3_BUCKET || '',
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        // Public base URL the bucket serves objects from (CDN/public endpoint). The
        // stored image URL is `${publicBaseUrl}/${key}` — this is what Meta fetches.
        publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || '',
        // Per-workspace generous abuse-safety cap (NOT a normal-use wall — one image
        // per post is self-limiting). Default 1 GB ≈ ~500 posts at 2 MB.
        quotaBytes: parseInt(process.env.POST_REPLY_IMAGE_QUOTA_BYTES || String(1024 * 1024 * 1024), 10),
    },

    // Circuit Breaker (ai-worker HTTP calls)
    circuitBreaker: {
        /** Consecutive failures before opening the circuit (default: 5) */
        failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10),
        /** Seconds to stay open before allowing one recovery probe (default: 30) */
        openDurationSeconds: parseInt(process.env.CIRCUIT_BREAKER_OPEN_DURATION_SECONDS || '30', 10),
    },
};
