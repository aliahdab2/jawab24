import dotenv from "dotenv";
dotenv.config();

// Initialize Sentry FIRST (before other imports)
import { initSentry, Sentry } from "./lib/sentry";
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
import commentsRoutes from "./routes/comments";
import settingsRoutes from "./routes/settings";
import messagesRoutes from "./routes/messages";
import instagramRoutes from "./routes/instagram";
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
import { customerNotificationService } from "./services/customerNotifications";
import { startEscalationCron, stopEscalationCron, setEscalationLogger } from "./services/escalation";
import { startTokenRefreshCron, stopTokenRefreshCron, setTokenRefreshLogger } from "./services/tokenRefresh";
import { setLeadDigestLogger, runDailyLeadDigest } from "./services/leadDigest";
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

const start = async () => {
  try {
    // Set global error handler
    server.setErrorHandler(errorHandler);

    // Add request ID middleware (must be first)
    server.addHook("onRequest", requestIdMiddleware);

    // Add geo middleware (must be early for sanctions checking)
    const { geoMiddleware } = await import("./middleware/geo");
    server.addHook("onRequest", geoMiddleware);

    // CSRF protection for cookie-based web requests
    // Skips: Bearer token auth (mobile), GET/HEAD/OPTIONS, unauthenticated requests
    server.addHook("onRequest", csrfProtection);

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

    const allowedOrigins = isProduction
      ? [config.frontendUrl, ...mobileOrigins]
      : ["http://localhost:3000", "http://localhost:3001", ...mobileOrigins];

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
        // rather than flooding with individual events.
        Sentry.withScope((scope) => {
          scope.setFingerprint(['rate-limit-exceeded', request.url, request.ip]);
          scope.setLevel('warning');
          scope.setTag('url', request.url);
          scope.setExtra('ip', request.ip);
          scope.setExtra('workspaceId', request.headers['x-workspace-id']);
          Sentry.captureMessage(`Rate limit exceeded: ${request.url}`);
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
    await server.register(postsRoutes);
    await server.register(commentsRoutes);
    await server.register(settingsRoutes);
    await server.register(messagesRoutes);
    await server.register(leadsRoutes);
    await server.register(instagramRoutes);
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

    // Lead digest cron — once per day, emails owners with ≥10 new leads
    // Threshold + stamping in service guarantees at most one email per user per day.
    setLeadDigestLogger(workerLogger);
    const LEAD_DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
    setInterval(() => {
      runDailyLeadDigest().catch(err => {
        server.log.error(err, '[LeadDigest] Scheduled run failed');
        captureError(err, '[LeadDigest] Scheduled run failed', { tags: { cron: 'lead_digest' }, level: 'error' });
      });
    }, LEAD_DIGEST_INTERVAL_MS);
    // First run delayed 5 min after startup so it doesn't block boot
    setTimeout(() => {
      runDailyLeadDigest().catch(err => {
        server.log.error(err, '[LeadDigest] Initial run failed');
        captureError(err, '[LeadDigest] Initial run failed', { tags: { cron: 'lead_digest' }, level: 'error' });
      });
    }, 5 * 60 * 1000);

    // Database cleanup scheduler — runs every 6 hours to enforce data retention
    // AI cache: 30 days, logs: 90 days, usage logs: 180 days
    const { runAllCleanupTasks } = await import("./utils/cleanup");
    const cleanupLogger = createRequestLogger(server.log);
    setInterval(() => {
      runAllCleanupTasks(undefined, cleanupLogger).catch(err => {
        server.log.error(err, 'Scheduled cleanup failed');
        captureError(err, 'Scheduled cleanup failed', { tags: { cron: 'cleanup' }, level: 'error' });
      });
    }, 6 * 60 * 60 * 1000); // Every 6 hours
    // Run once on startup (delayed 60s to let DB connections settle)
    setTimeout(() => {
      runAllCleanupTasks(undefined, cleanupLogger).catch(err => {
        server.log.error(err, 'Initial cleanup failed');
        captureError(err, 'Initial cleanup failed', { tags: { cron: 'cleanup' }, level: 'error' });
      });
    }, 60_000);

    // Stripe top-up reconciliation — every 15 min, recover `pending` top-ups
    // whose payment_intent.succeeded webhook was missed/misconfigured (money
    // captured by Stripe but replies not yet credited). settleStripeTopup is
    // idempotent (status='pending' guard), so this never double-credits even
    // running alongside the live webhook.
    const { topupService } = await import('./services/topup');
    const TOPUP_RECONCILE_INTERVAL_MS = 15 * 60 * 1000; // 15 min
    const runTopupReconcile = (label: string) => {
      topupService.reconcileStripeTopups()
        .then(r => {
          if (r.scanned > 0) server.log.info(r, `[TopupReconcile] ${label}`);
          if (r.credited > 0) {
            captureError(
              new Error(`Top-up reconciliation credited ${r.credited} purchase(s) a missed webhook should have`),
              '[TopupReconcile] recovered missed webhook credits',
              { level: 'warning', tags: { cron: 'topup_reconcile' }, extra: { ...r } },
            );
          }
        })
        .catch(err => {
          server.log.error(err, `[TopupReconcile] ${label} failed`);
          captureError(err, `[TopupReconcile] ${label} failed`, { tags: { cron: 'topup_reconcile' }, level: 'error' });
        });
    };
    setInterval(() => runTopupReconcile('scheduled sweep'), TOPUP_RECONCILE_INTERVAL_MS);
    // First run 3 min after boot (after the webhook's fair-chance window).
    setTimeout(() => runTopupReconcile('initial sweep'), 3 * 60 * 1000);

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

    // Payment-request reconciliation — every 15 min, recover `pending` admin
    // "collect payment" rows whose checkout.session.completed webhook was
    // missed/late (customer paid but the ledger still shows unpaid). markPaid is
    // status='pending'-gated so this never re-flips a row, and it NEVER touches
    // reply balance (collect-only). Safe to run alongside the live webhook.
    const { paymentRequestService } = await import('./services/paymentRequest');
    const PAYMENT_REQUEST_RECONCILE_INTERVAL_MS = 15 * 60 * 1000; // 15 min
    const runPaymentRequestReconcile = (label: string) => {
      paymentRequestService.reconcilePending()
        .then(r => {
          if (r.scanned > 0) server.log.info(r, `[PaymentRequestReconcile] ${label}`);
          if (r.paid > 0) {
            captureError(
              new Error(`Payment-request reconciliation marked ${r.paid} request(s) paid a missed webhook should have`),
              '[PaymentRequestReconcile] recovered missed webhook settlements',
              { level: 'warning', tags: { cron: 'payment_request_reconcile' }, extra: { ...r } },
            );
          }
        })
        .catch(err => {
          server.log.error(err, `[PaymentRequestReconcile] ${label} failed`);
          captureError(err, `[PaymentRequestReconcile] ${label} failed`, { tags: { cron: 'payment_request_reconcile' }, level: 'error' });
        });
    };
    setInterval(() => runPaymentRequestReconcile('scheduled sweep'), PAYMENT_REQUEST_RECONCILE_INTERVAL_MS);
    // First run 3 min after boot (after the webhook's fair-chance window).
    setTimeout(() => runPaymentRequestReconcile('initial sweep'), 3 * 60 * 1000);

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

    // Stop workers (wait for in-progress jobs)
    console.log("⏳ Stopping workers...");
    await Promise.all([
      stopWorker(),
      stopCustomerNotificationWorker(),
      stopWebhookRetryWorker(),
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
