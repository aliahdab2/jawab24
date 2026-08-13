import dotenv from "dotenv";
dotenv.config();

// Initialize Sentry FIRST (before other imports)
import { initSentry, Sentry, rateLimitCaptureMessage } from "./lib/sentry";
initSentry();

import fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { registerPlugin } from "./utils/register-plugin";
import healthRoutes from "./routes/health";
import authRoutes from "./routes/auth";
import webhookRoutes from "./routes/webhook";
import aiRoutes from "./routes/ai";
import pagesRoutes from "./routes/pages";
import postsRoutes from "./routes/posts";
import postReplyImageRoutes from "./routes/postReplyImage";
import commentsRoutes from "./routes/comments";
import settingsRoutes from "./routes/settings";
import messagesRoutes from "./routes/messages";
import instagramRoutes from "./routes/instagram";
import whatsappRoutes from "./routes/whatsapp";
import versionRoutes from "./routes/version";
import plansRoutes from "./routes/plans";
import subscriptionsRoutes from "./routes/subscriptions";
import paymentRoutes from "./routes/payment";
import geoRoutes from "./routes/geo";
import notificationRoutes from "./routes/notifications";
import adminRoutes from "./routes/admin";
import voiceRoutes from "./routes/voice";
import kbUploadRoutes from "./routes/kb-upload";
import analyticsRoutes from "./routes/analytics";
import workspaceRoutes from "./routes/workspace";
import { translationRoutes } from "./routes/translation";
import integrationsRoutes from "./routes/integrations";
import waitlistRoutes from "./routes/waitlist";
import sseRoutes from "./routes/sse";
import customerNotificationRoutes from "./routes/customerNotifications";
import ecommerceAnalyticsRoutes from "./routes/ecommerceAnalytics";
import leadsRoutes from "./routes/leads";
import catalogRoutes from "./routes/catalog";
import postSuggestionsRoutes from "./routes/postSuggestions";
import factCollectionsRoutes from "./routes/factCollections";
import { sseManager } from "./lib/sseManager";
import { shutdownEventBus } from "./lib/eventBus";
import { integrationRegistry } from "./integrations";
import { errorHandler } from "./middleware/errorHandler";
import { requestIdMiddleware } from "./middleware/requestId";
import { csrfProtection } from "./middleware/auth";
import { validateEnv } from "./utils/env";
import { redis } from "./lib/redis";
import { startWorker, stopWorker, setWorkerLogger } from "./workers/replyWorker";
import { startCustomerNotificationWorker, stopCustomerNotificationWorker, setCustomerNotificationWorkerLogger } from "./workers/customerNotificationWorker";
import { startWebhookRetryWorker, stopWebhookRetryWorker, setWebhookRetryWorkerLogger } from "./workers/webhookRetryWorker";
import { startPostSuggestionWorker, stopPostSuggestionWorker, setPostSuggestionWorkerLogger } from "./workers/postSuggestionWorker";
import { customerNotificationService } from "./services/customerNotifications";
import { startEscalationCron, stopEscalationCron, setEscalationLogger } from "./services/escalation";
import { startTokenRefreshCron, stopTokenRefreshCron, setTokenRefreshLogger } from "./services/tokenRefresh";
import { startWhatsAppTokenHealthCron, stopWhatsAppTokenHealthCron, setWhatsAppTokenHealthLogger } from "./services/whatsappTokenHealth";
import { setLeadDigestLogger, runDailyLeadDigest } from "./services/leadDigest";
import { setPostSuggestionsLogger, postSuggestionsService } from "./services/postSuggestions";
import { imageStorage } from "./services/imageStorage";
import { setTrialRemindersLogger, runTrialEndingReminders, runTrialEndedNotices } from "./services/trialReminders";
import { scheduleRecurringJob } from "./lib/scheduledJob";
import { captureError } from "./utils/sentryHelpers";
import { smsService } from "./services/sms";
import { emailService } from "./services/email";
import { createRequestLogger } from "./types";
import { config } from "./config";
import demoPlugin from "./plugins/demo";
import swaggerPlugin from "./plugins/swagger";
import { ensureAdminUsers } from "./utils/adminSetup";
import { ensureMetaWebhookSubscriptions } from "./services/metaWebhooks";
import { sanitizeRequestHeaders } from "./utils/logSanitizer";

// ⚡ Validate environment variables on startup
try {
  validateEnv();
  console.log("✅ Environment variables validated successfully");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const server = fastify({
  logger: {
    level: config.logLevel,
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          headers: sanitizeRequestHeaders(
            request.headers as Record<string, string | string[] | undefined>,
          ),
          hostname: request.hostname,
          remoteAddress: request.ip,
          remotePort: request.socket.remotePort,
        };
      },
    },
  },
  bodyLimit: 10485760, // 10MB
  requestIdHeader: "x-request-id",
  requestIdLogLabel: "requestId",
  trustProxy: true, // Critical: Trust Nginx proxy headers to get real client IP
});

// Add rawBody support for webhook signature verification (Stripe, Shopify, Facebook)
// The rawBody property is declared in types/fastify.d.ts via module augmentation
server.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (req, body, done) => {
    try {
      req.rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
      const text = body.toString("utf8");
      // Treat empty / whitespace-only body as `{}` so routes that don't read
      // the body (e.g. POST /shopify/store/sync) accept curl/CLI callers that
      // send `Content-Type: application/json` with no payload.
      if (text.trim() === "") {
        done(null, {});
        return;
      }
      const json = JSON.parse(text);
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  },
);

// Facebook posts its GDPR data-deletion (and deauthorize) callback as
// application/x-www-form-urlencoded with a `signed_request` field. Without a parser
// for this content type Fastify 415s the request and the handler never runs, so
// user-initiated deletions were silently never fulfilled. Parse it into an object
// (and keep rawBody for parity with the JSON parser). Built-in URLSearchParams — no
// new dependency.
server.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "buffer" },
  (req, body, done) => {
    try {
      req.rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
      const params = new URLSearchParams(body.toString("utf8"));
      const parsed: Record<string, string> = {};
      for (const [key, value] of params) parsed[key] = value;
      done(null, parsed);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  },
);

const start = async () => {
  try {
    // Set global error handler
    server.setErrorHandler(errorHandler);

    // Add request ID middleware (must be first)
    server.addHook("onRequest", requestIdMiddleware);

    // Add geo middleware (must be early for sanctions checking)
    const { geoMiddleware } = await import("./middleware/geo");
    server.addHook("onRequest", geoMiddleware);

    // CSRF protection for cookie-based web requests.
    // Skips: Bearer token auth (mobile), GET/HEAD/OPTIONS, unauthenticated requests.
    // MUST be a preHandler (not onRequest): the @fastify/cookie parser runs as an
    // onRequest hook registered later (below), so an onRequest CSRF hook ran before
    // cookies were parsed — request.cookies was always empty and the check silently
    // no-op'd. preHandler always runs after every onRequest hook, so cookies are
    // populated. Web mutations send X-CSRF-Token via the frontend axios interceptor;
    // sameSite:strict on the auth cookie remains the primary CSRF defense.
    server.addHook("preHandler", csrfProtection);

    // Register plugins
    // CORS: Environment-based origin configuration
    // - Production: Allow FRONTEND_URL and mobile app origins
    // - Development: Allow localhost ports
    const isProduction = config.nodeEnv === "production";
    const mobileOrigins = [
      "capacitor://localhost",
      "http://localhost",
      "https://localhost",
      "https://app.jawab24.com",   // Capacitor Android WebView (androidScheme: https)
      "capacitor://app.jawab24.com", // Capacitor iOS WebView (default iOS scheme)
      "com.jawab24.app",
    ];

    // Dev allows ANY localhost port: worktree dev servers run on their own
    // ports (Rule 18.5 — 3001 is frequently held by another checkout), and a
    // hard-coded pair forced every parallel worktree into a CORS dead end.
    // Production stays pinned to the configured frontend origin.
    const allowedOrigins = isProduction
      ? [config.frontendUrl, ...mobileOrigins]
      : [/^http:\/\/localhost:\d+$/, ...mobileOrigins];

    await registerPlugin(server, cors, {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    });

    await registerPlugin(server, helmet, {
      contentSecurityPolicy: false, // Disable for API
    });

    // Register compression for better performance on poor connections
    // Reduces response sizes by 60-70%
    await registerPlugin(server, compress, {
      global: true,
      threshold: 1024, // Only compress responses > 1KB
      encodings: ["br", "gzip", "deflate"], // Prefer brotli, fallback to gzip
    });

    // Register Swagger API docs (must be before routes)
    await server.register(swaggerPlugin);

    // Register health and version routes BEFORE rate limit to exempt them
    await server.register(healthRoutes);
    await server.register(versionRoutes);

    // Register cookie plugin
    // COOKIE_SECRET is validated at startup via validateEnv() - no fallback needed
    await registerPlugin(server, cookie, {
        secret: config.cookieSecret,
        hook: 'onRequest',
        parseOptions: {}
    });

    // Register rate limiting
    // Use shared Redis instance for consistency across blue/green deployments
    await registerPlugin(server, rateLimit, {
      max: 5000, // 5000 requests per 15 minutes (~5.5 req/s per IP)
      timeWindow: "15 minutes",
      redis,
      errorResponseBuilder: (request: { ip: string }, context: { after: string }) => ({
        error: true,
        message: "Rate limit exceeded. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
        statusCode: 429,
        retryAfter: context.after,
      }),
      onExceeded: (request: { ip: string; url: string; headers: Record<string, string | string[] | undefined> }) => {
        // Fingerprint by IP + URL so repeated hits group into one Sentry issue
        // rather than flooding with individual events. The message comes from
        // rateLimitCaptureMessage() — it must not match SENTRY_IGNORE_ERRORS,
        // or this capture is silently dropped (see lib/sentry.ts).
        Sentry.withScope((scope) => {
          scope.setFingerprint(['rate-limit-exceeded', request.url, request.ip]);
          scope.setLevel('warning');
          scope.setTag('url', request.url);
          scope.setExtra('ip', request.ip);
          scope.setExtra('workspaceId', request.headers['x-workspace-id']);
          Sentry.captureMessage(rateLimitCaptureMessage(request.url));
        });
      },
    });

    // Register other routes
    await server.register(authRoutes);
    
    // Demo mode plugin (only active when DEMO_MODE_ENABLED=true)
    if (config.demo.enabled) {
      await server.register(demoPlugin);
      console.log("🎭 Demo mode enabled");
    }
    
    await server.register(webhookRoutes);
    await server.register(aiRoutes);
    await server.register(pagesRoutes);
    await server.register(catalogRoutes);
    await server.register(factCollectionsRoutes);
    await server.register(postSuggestionsRoutes);
    await server.register(postsRoutes);
    // Public: stable tap-through for Post Reply image cards already sitting in customer threads.
    await server.register(postReplyImageRoutes);
    await server.register(commentsRoutes);
    await server.register(settingsRoutes);
    await server.register(messagesRoutes);
    await server.register(leadsRoutes);
    await server.register(instagramRoutes);
    await server.register(whatsappRoutes);
    await server.register(plansRoutes, { prefix: "/plans" });
    await server.register(subscriptionsRoutes, { prefix: "/subscription" });
    await server.register(paymentRoutes, { prefix: "/payment" });
    await server.register(geoRoutes, { prefix: "/geo" });
    await server.register(notificationRoutes, { prefix: "/notifications" });
    await server.register(adminRoutes, { prefix: "/admin" });
    await server.register(voiceRoutes, { prefix: "/voice" });
    await server.register(kbUploadRoutes, { prefix: "/kb" });
    await server.register(workspaceRoutes);
    await server.register(analyticsRoutes, { prefix: "/analytics" });
    // Translation route — non-critical, guarded so it can't crash the server
    try {
      await server.register(translationRoutes, { prefix: "/api/translation" });
    } catch (err) {
      server.log.error(err, 'Failed to register translation routes — skipping');
    }

    // Integrations status route (authenticated)
    await server.register(integrationsRoutes, { prefix: "/api/integrations" });

    // Waitlist (public - no auth required)
    await server.register(waitlistRoutes, { prefix: "/waitlist" });

    // Customer notification templates + log (authenticated)
    await server.register(customerNotificationRoutes);
    await server.register(ecommerceAnalyticsRoutes, { prefix: "/api/ecommerce-analytics" });

    // SSE real-time events (authenticated inside the route handler)
    await server.register(sseRoutes, { prefix: "/sse" });
    sseManager.start();

    // Register e-commerce integration routes (Shopify, future WooCommerce, etc.)
    for (const integration of integrationRegistry.getEnabled()) {
      await integration.registerRoutes(server);
    }

    const host = "0.0.0.0";

    await server.listen({ port: config.port, host });
    console.log(`🚀 Server listening on http://${host}:${config.port}`);
    console.log(`📊 Health check: http://${host}:${config.port}/health`);
    console.log(`🌍 Environment: ${config.nodeEnv}`);

    // Ensure admin users are set up from environment variables
    await ensureAdminUsers();

    // Start the reply processing worker
    // Create a logger adapter for the worker
    const workerLogger = createRequestLogger(server.log);
    startWorker(workerLogger);
    console.log(`⚙️  Reply processing worker started`);

    setCustomerNotificationWorkerLogger(workerLogger);
    customerNotificationService.setLogger(workerLogger);
    startCustomerNotificationWorker();
    console.log(`⚙️  Customer notification worker started`);

    setWebhookRetryWorkerLogger(workerLogger);
    startWebhookRetryWorker();
    console.log(`⚙️  Webhook retry worker started`);

    // «بوست اليوم» generation. Started unconditionally, like its siblings: the
    // feature's own gate decides whether anything is ever queued, and a worker
    // that only starts for allowlisted workspaces would leave rows pending on
    // the very deploy that widens the allowlist.
    setPostSuggestionWorkerLogger(workerLogger);
    startPostSuggestionWorker();
    console.log(`⚙️  Post suggestion worker started`);

    // Start e-commerce integration workers (Shopify, future WooCommerce, etc.)
    for (const integration of integrationRegistry.getEnabled()) {
      await integration.onStartup(workerLogger);
      console.log(`⚙️  ${integration.name} integration started`);
    }

    // Start escalation cron (checks for stale unreplied comments/messages every 5 min)
    setEscalationLogger(workerLogger);
    smsService.setLogger(workerLogger);
    emailService.setLogger(workerLogger);
    startEscalationCron();

    // Start Facebook token refresh cron (refreshes tokens expiring within 7 days, every 6h)
    setTokenRefreshLogger(workerLogger);
    startTokenRefreshCron();

    // WhatsApp token health cron — separate from the Facebook one because WhatsApp
    // business tokens expire on a CLOCK (Meta forces 60 days on the Embedded Signup
    // login variation) rather than on revocation. Warns the merchant ahead of expiry
    // and flags dead tokens, since inbound webhooks keep arriving after expiry and
    // customers would otherwise just get silence.
    setWhatsAppTokenHealthLogger(workerLogger);
    startWhatsAppTokenHealthCron();

    const logJobError = (err: unknown, msg: string) => server.log.error(err, msg);
    const DAILY_MS = 24 * 60 * 60 * 1000;

    // Lead digest cron — once per day, emails owners with ≥10 new leads
    // Threshold + stamping in service guarantees at most one email per user per day.
    setLeadDigestLogger(workerLogger);
    scheduleRecurringJob({
      label: '[LeadDigest]',
      tag: 'lead_digest',
      intervalMs: DAILY_MS,
      // First run delayed 5 min after startup so it doesn't block boot
      initialDelayMs: 5 * 60 * 1000,
      run: runDailyLeadDigest,
      logError: logJobError,
    });

    // Trial-ending reminder cron — once per day, warns merchants 3 days before
    // their trial expires. Stamping in the service guarantees one warning per
    // trial no matter how often this runs.
    setTrialRemindersLogger(workerLogger);
    scheduleRecurringJob({
      label: '[TrialReminders]',
      tag: 'trial_reminders',
      intervalMs: DAILY_MS,
      // Staggered 2 min behind the lead digest so the two daily jobs don't share a tick
      initialDelayMs: 7 * 60 * 1000,
      run: runTrialEndingReminders,
      logError: logJobError,
    });

    // Trial-ended "last try" cron — once per day, tells merchants whose trial
    // just expired that replies have stopped (in-app + email). Proactive
    // counterpart of the reactive auto_reply_paused_billing notification,
    // which only fires when a customer writes in.
    scheduleRecurringJob({
      label: '[TrialEnded]',
      tag: 'trial_ended_notices',
      intervalMs: DAILY_MS,
      // Staggered 2 min behind the ending-reminder sweep, same reasoning
      initialDelayMs: 9 * 60 * 1000,
      run: runTrialEndedNotices,
      logError: logJobError,
    });

    // «إنشاء منشور» seed sweep — NOT a daily generator. It gives a page its
    // FIRST post, once, so a merchant meets the feature with something finished
    // in it; every post after that is generated on demand (owner ruling
    // 2026-08-13). It stays on a schedule only because eligibility arrives over
    // time — a page connects, a workspace joins the allowlist — and this is how
    // those pages get seeded without a separate event hook.
    //
    // Seeding is self-limiting: the predicate is "this page has no rows at
    // all", and rows are never deleted, so a seeded page can never be seeded
    // again no matter how often this ticks. EXPLICITLY allowlisted pages only
    // (empty allowlist = seeds nothing; an unprompted generation is spend no
    // user asked for), and each seed consumes the same absolute 3/day cap as
    // the merchant's own button.
    setPostSuggestionsLogger(workerLogger);
    if (config.postSuggestions.enabled && !imageStorage.isConfigured()) {
      // Without object storage every generation silently ships TEXT-ONLY
      // (`storage_off` degrade). The response tells the merchant; this boot
      // line tells ops — otherwise an env drift is invisible until a human
      // complains about imageless cards.
      workerLogger.warn('[PostSuggestions] Enabled but object storage is NOT configured — all generations will be text-only (storage_off)');
    }
    scheduleRecurringJob({
      label: '[PostSuggestions]',
      tag: 'post_suggestions',
      // Daily is a POLL INTERVAL now, not a generation cadence: it only bounds
      // how long a newly-eligible page waits for its one seed.
      intervalMs: DAILY_MS,
      // Staggered 2 min behind the trial-ended sweep so the daily jobs don't share a tick
      initialDelayMs: 11 * 60 * 1000,
      run: () => postSuggestionsService.seedFirstPostSuggestions(),
      logError: logJobError,
    });

    // Database cleanup scheduler — runs every 6 hours to enforce data retention
    // AI cache: 30 days, logs: 90 days, usage logs: 180 days
    const { runAllCleanupTasks } = await import("./utils/cleanup");
    const cleanupLogger = createRequestLogger(server.log);
    scheduleRecurringJob({
      label: '[Cleanup]',
      tag: 'cleanup',
      intervalMs: 6 * 60 * 60 * 1000,
      // Delayed 60s to let DB connections settle
      initialDelayMs: 60_000,
      run: () => runAllCleanupTasks(undefined, cleanupLogger),
      logError: logJobError,
    });

    // OpenAI cost snapshot + credit-runway alert — once per day. Pulls the
    // AUTHORITATIVE Costs API (trailing window so late OpenAI adjustments overwrite
    // via the idempotent upsert), then evaluates credit runway and fires the
    // proactive "credits low" alert BEFORE the wallet hits zero (the 2026-06-28
    // outage had no early warning). No-ops when no org admin key is configured.
    const { runOpenAiCostSync } = await import("./services/aiCostSync");
    scheduleRecurringJob({
      label: '[CostSnapshot]',
      tag: 'ai_cost_snapshot',
      intervalMs: DAILY_MS,
      // First run delayed 90s after boot so DB connections settle.
      initialDelayMs: 90_000,
      run: async () => {
        // Daily incremental: trailing 3-day window (idempotent upsert absorbs late
        // OpenAI cost adjustments). The admin "Sync now" button uses a wider backfill.
        const result = await runOpenAiCostSync(3);
        if (result.configured) {
          server.log.info({ synced: result.synced }, '[CostSnapshot] Synced OpenAI cost snapshots');
        }
      },
      logError: logJobError,
    });

    // Reply-queue backlog watch — the D-016 "sustained queue wait-time" signal.
    // Evaluates live queue depth + recent p95 wait every minute; two consecutive
    // breaches fire a throttled admin alert (alert:reply_queue_backlog). The
    // remedies (raise REPLY_WORKER_CONCURRENCY, per-channel split) stay manual.
    const { evaluateQueueBacklogAndAlert } = await import("./services/replyQueueHealth");
    setInterval(() => {
      evaluateQueueBacklogAndAlert().catch(err => {
        server.log.error(err, '[QueueHealth] Scheduled evaluation failed');
        captureError(err, '[QueueHealth] Scheduled evaluation failed', { tags: { cron: 'reply_queue_health' }, level: 'error' });
      });
    }, config.replyQueueHealth.evalIntervalMs);
    // First run delayed 90s after boot so Redis/queue connections settle.
    setTimeout(() => {
      evaluateQueueBacklogAndAlert().catch(err => {
        server.log.error(err, '[QueueHealth] Initial evaluation failed');
        captureError(err, '[QueueHealth] Initial evaluation failed', { tags: { cron: 'reply_queue_health' }, level: 'error' });
      });
    }, 90_000);

    // Shared scaffold for the Stripe reconciliation sweeps (top-up credits +
    // admin collect-payment). Both poll Stripe every 15 min to recover rows a
    // missed webhook left `pending`, log only when something was scanned, raise
    // ONE Sentry warning when a sweep recovered work a webhook should have done,
    // and isolate failures. First run 3 min after boot (the webhook's
    // fair-chance window). Generic so a third sweep can't drift from the pattern.
    const RECONCILE_INTERVAL_MS = 15 * 60 * 1000; // 15 min
    const scheduleReconcileCron = <R extends { scanned: number }>(opts: {
      label: string;
      tag: string;
      run: () => Promise<R>;
      recovered: (r: R) => { count: number; message: string };
      enabled?: () => boolean;
      /** Override the 15-min default for sweeps that call rate-limited third-party APIs per row. */
      intervalMs?: number;
    }) => {
      const tick = (phase: string) => {
        if (opts.enabled && !opts.enabled()) return; // kill-switch / feature gate
        opts.run()
          .then(r => {
            // Cast to a concrete object: pino's overload can't resolve our bare
            // generic R, but every sweep result is a flat record.
            if (r.scanned > 0) server.log.info(r as Record<string, unknown>, `[${opts.label}] ${phase}`);
            const rec = opts.recovered(r);
            if (rec.count > 0) {
              captureError(new Error(rec.message), `[${opts.label}] recovered missed webhook work`, {
                level: 'warning', tags: { cron: opts.tag }, extra: { ...r },
              });
            }
          })
          .catch(err => {
            server.log.error(err, `[${opts.label}] ${phase} failed`);
            captureError(err, `[${opts.label}] ${phase} failed`, { tags: { cron: opts.tag }, level: 'error' });
          });
      };
      setInterval(() => tick('scheduled sweep'), opts.intervalMs ?? RECONCILE_INTERVAL_MS);
      setTimeout(() => tick('initial sweep'), 3 * 60 * 1000);
    };

    // Stripe top-up reconciliation — recover `pending` top-ups whose
    // payment_intent.succeeded webhook was missed (money captured, replies not
    // yet credited). settleStripeTopup is status='pending'-gated so this never
    // double-credits alongside the live webhook. Gated by the kill-switch (no
    // pending rows exist while disabled, and we don't want sweep noise).
    const { topupService } = await import('./services/topup');
    scheduleReconcileCron({
      label: 'TopupReconcile',
      tag: 'topup_reconcile',
      enabled: () => config.topup.enabled,
      run: () => topupService.reconcileStripeTopups(),
      recovered: r => ({ count: r.credited, message: `Top-up reconciliation credited ${r.credited} purchase(s) a missed webhook should have` }),
    });

    // KB re-ingest reconciliation — self-heal pages whose vector chunks drifted from their KB text.
    // A KB edit bumps kb_version then re-ingests FIRE-AND-FORGET; if that async ingest failed/lagged,
    // kb_active_version stays behind and retrieval serves stale (or no) chunks → wrong/"not available"
    // replies. This sweep re-ingests the current KB so retrieval converges within minutes, for every
    // merchant, with no manual work. Gated by KB_REINGEST_RECONCILE_ENABLED (and the OpenAI key).
    const { reingestDriftedPages } = await import('./services/kb/reingestReconciler');
    scheduleReconcileCron({
      label: 'KbReingestReconcile',
      tag: 'kb_reingest_reconcile',
      enabled: () => config.kbReingest.enabled && !!config.openai.apiKey,
      run: () => reingestDriftedPages(),
      recovered: r => ({ count: r.reingested, message: `KB re-ingest reconciler healed ${r.reingested} page(s) whose chunks had drifted from their KB text` }),
    });

    // Subscription reconciliation — activate merchants who paid in Stripe but
    // were never linked here. The webhook path is a single point of failure: one
    // dropped delivery and a merchant is charged for nothing, silently, because
    // every handler resolves our row by external_subscription_id and a missing
    // link just matches zero rows. Stripe is the authority on who is paying, so
    // ask it. Idempotent — linked subscriptions are skipped.
    const { reconcileStripeSubscriptions } = await import('./services/subscriptionLinking');
    scheduleReconcileCron({
      label: 'SubscriptionReconcile',
      tag: 'subscription_reconcile',
      enabled: () => !!config.stripe.secretKey,
      run: () => reconcileStripeSubscriptions({ log: server.log }),
      recovered: r => ({ count: r.healed, message: `Subscription reconciliation activated ${r.healed} merchant(s) who had paid but were never linked` }),
    });

    // Shopify App Pricing billing reconciliation — the authority of last resort
    // (D-B/D-C). Shopify delivers NO webhook for App Pricing enrollments after
    // 2026-04-28, so the redirect trigger + post-claim hook are best-effort and
    // THIS sweep is what guarantees a paying merchant is eventually activated
    // (and a lapsed one eventually paused). 6-hourly, not 15-min: each swept
    // store costs one Admin API call against Shopify's rate budget.
    const { reconcileShopifyBilling } = await import('./services/shopifyBilling');
    scheduleReconcileCron({
      label: 'ShopifyBillingReconcile',
      tag: 'shopify_billing_reconcile',
      enabled: () => !!config.shopify.apiKey,
      intervalMs: 6 * 60 * 60 * 1000,
      run: () => reconcileShopifyBilling({ log: server.log }),
      recovered: r => ({ count: r.healed, message: `Shopify billing reconciliation mirrored ${r.healed} subscription change(s) the live triggers missed` }),
    });

    // Zid App Market billing reconciliation — the authority of last resort.
    // Zid DOES deliver app.market.subscription.* webhooks, but a delivery that
    // never arrives (endpoint down, Zid's redelivery policy is uncaptured —
    // ZID_TEST_PLAN §I-3) would otherwise strand a paying merchant forever.
    // This sweep is what makes a missed webhook a delay instead of a lost
    // subscription (§H-9). 6-hourly, matching Shopify: each swept store costs
    // one Merchant API call.
    const { reconcileZidBilling } = await import('./services/zidBilling');
    scheduleReconcileCron({
      label: 'ZidBillingReconcile',
      tag: 'zid_billing_reconcile',
      enabled: () => !!config.zid.clientId,
      intervalMs: 6 * 60 * 60 * 1000,
      run: () => reconcileZidBilling({ log: server.log }),
      recovered: r => ({ count: r.healed, message: `Zid billing reconciliation mirrored ${r.healed} subscription change(s) the live triggers missed` }),
    });

    // E-commerce scheduled sync — refreshes inventory every 6 hours across all platforms
    // Catches stock changes from sales that webhooks don't cover (inventory_levels/update)
    const { getAllActiveStores } = await import('./services/ecommerce');
    const { enqueueSyncJob } = await import('./lib/ecommerceSyncQueue');
    setInterval(async () => {
      try {
        const stores = await getAllActiveStores();
        for (const store of stores) {
          await enqueueSyncJob(store.id, store.platform as 'shopify' | 'salla' | 'zid');
        }
        server.log.info(`[EcommerceScheduler] Enqueued sync for ${stores.length} store(s)`);
      } catch (err) {
        server.log.error(err, '[EcommerceScheduler] Scheduled sync failed');
        captureError(err, '[EcommerceScheduler] Scheduled sync failed', { tags: { cron: 'ecommerce_sync' }, level: 'error' });
      }
    }, 6 * 60 * 60 * 1000); // Every 6 hours

    // Payment-request reconciliation — recover `pending` admin "collect payment"
    // rows whose checkout.session.completed webhook was missed/late. markPaid is
    // status='pending'-gated and NEVER touches reply balance (collect-only).
    const { paymentRequestService } = await import('./services/paymentRequest');
    scheduleReconcileCron({
      label: 'PaymentRequestReconcile',
      tag: 'payment_request_reconcile',
      run: () => paymentRequestService.reconcilePending(),
      recovered: r => ({ count: r.paid, message: `Payment-request reconciliation marked ${r.paid} request(s) paid a missed webhook should have` }),
    });

    // Verify app-level webhook subscriptions with Meta on startup
    // This ensures the callback URL is verified after every deploy
    ensureMetaWebhookSubscriptions(config.webhookCallbackUrl, createRequestLogger(server.log)).then(ok => {
      if (ok) {
        console.log(`✅ Meta webhook subscriptions verified (${config.webhookCallbackUrl})`);
      } else {
        console.warn(`⚠️  One or more Meta webhook subscriptions failed — some webhooks may not be delivered`);
      }
    }).catch(err => {
      server.log.error(err, 'Meta webhook subscription check failed');
      Sentry.captureException(err);
    });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  console.log(`\n${signal} received, closing server gracefully...`);

  try {
    // Stop cron jobs
    stopEscalationCron();
    stopTokenRefreshCron();
    stopWhatsAppTokenHealthCron();

    // Stop workers (wait for in-progress jobs)
    console.log("⏳ Stopping workers...");
    await Promise.all([
      stopWorker(),
      stopCustomerNotificationWorker(),
      stopWebhookRetryWorker(),
      // Waits for an in-flight generation rather than killing it: the merchant's
      // cap slot is already spent, so a job abandoned mid-flight during a deploy
      // would leave a paid-for row stuck pending.
      stopPostSuggestionWorker(),
      ...integrationRegistry.getEnabled().map(i => i.onShutdown()),
    ]);
    console.log("✅ Workers stopped");

    // Close SSE connections + event bus before closing server
    await sseManager.shutdown();
    await shutdownEventBus();

    await server.close();
    await redis.quit();
    console.log("✅ Server closed successfully");
    process.exit(0);
  } catch (err) {
     
    console.error("❌ Error during shutdown:", err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), { tags: { context: 'shutdown' } });
    await Sentry.flush(2000);
    process.exit(1);
  }
};

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
   
  console.error("❌ Uncaught Exception:", error);
  Sentry.captureException(error, { tags: { context: 'uncaught-exception' } });
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason) => {
   
  console.error("❌ Unhandled Rejection:", reason);
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)), { tags: { context: 'unhandled-rejection' } });
  gracefulShutdown("UNHANDLED_REJECTION");
});

start();
