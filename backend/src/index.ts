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
import healthRoutes from "./routes/health";
import authRoutes from "./routes/auth";
import webhookRoutes from "./routes/webhook";
import rulesRoutes from "./routes/rules";
import templatesRoutes from "./routes/templates";
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
import analyticsRoutes from "./routes/analytics";
import workspaceRoutes from "./routes/workspace";
import { translationRoutes } from "./routes/translation";
import integrationsRoutes from "./routes/integrations";
import waitlistRoutes from "./routes/waitlist";
import sseRoutes from "./routes/sse";
import { sseManager } from "./lib/sseManager";
import { shutdownEventBus } from "./lib/eventBus";
import { integrationRegistry } from "./integrations";
import { errorHandler } from "./middleware/errorHandler";
import { requestIdMiddleware } from "./middleware/requestId";
import { csrfProtection } from "./middleware/auth";
import { validateEnv } from "./utils/env";
import { redis } from "./lib/redis";
import { startWorker, stopWorker, setWorkerLogger } from "./workers/replyWorker";
import { startEscalationCron, stopEscalationCron } from "./services/escalation";
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
      const json = JSON.parse(body.toString("utf8"));
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
      "com.jawab24.app",
    ];

    const allowedOrigins = isProduction
      ? [config.frontendUrl, ...mobileOrigins]
      : ["http://localhost:3000", "http://localhost:3001", ...mobileOrigins];

    await server.register(cors, {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    });

    await server.register(helmet, {
      contentSecurityPolicy: false, // Disable for API
    });

    // Register compression for better performance on poor connections
    // Reduces response sizes by 60-70%
    await server.register(compress, {
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
    await server.register(cookie, {
        secret: config.cookieSecret,
        hook: 'onRequest',
        parseOptions: {}
    });

    // Register rate limiting
    // Use shared Redis instance for consistency across blue/green deployments
    await server.register(rateLimit, {
      max: 2000, // 2000 requests per 15 minutes
      timeWindow: "15 minutes",
      redis,
      errorResponseBuilder: (request, context) => ({
        error: true,
        message: "Rate limit exceeded. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
        statusCode: 429,
        retryAfter: context.after,
      }),
    });

    // Register other routes
    await server.register(authRoutes);
    
    // Demo mode plugin (only active when DEMO_MODE_ENABLED=true)
    if (config.demo.enabled) {
      await server.register(demoPlugin);
      console.log("🎭 Demo mode enabled");
    }
    
    await server.register(webhookRoutes);
    await server.register(rulesRoutes);
    await server.register(templatesRoutes);
    await server.register(aiRoutes);
    await server.register(pagesRoutes);
    await server.register(postsRoutes);
    await server.register(commentsRoutes);
    await server.register(settingsRoutes);
    await server.register(messagesRoutes);
    await server.register(instagramRoutes);
    await server.register(plansRoutes, { prefix: "/plans" });
    await server.register(subscriptionsRoutes, { prefix: "/subscription" });
    await server.register(paymentRoutes, { prefix: "/payment" });
    await server.register(geoRoutes, { prefix: "/geo" });
    await server.register(notificationRoutes, { prefix: "/notifications" });
    await server.register(adminRoutes, { prefix: "/admin" });
    await server.register(voiceRoutes, { prefix: "/voice" });
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
    await server.register(waitlistRoutes, { prefix: "/api/waitlist" });

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

    // Start e-commerce integration workers (Shopify, future WooCommerce, etc.)
    for (const integration of integrationRegistry.getEnabled()) {
      await integration.onStartup(workerLogger);
      console.log(`⚙️  ${integration.name} integration started`);
    }

    // Start escalation cron (checks for stale unreplied comments/messages every 5 min)
    startEscalationCron();

    // Database cleanup scheduler — runs every 6 hours to enforce data retention
    // AI cache: 30 days, logs: 90 days, usage logs: 180 days
    const { runAllCleanupTasks } = await import("./utils/cleanup");
    const cleanupLogger = createRequestLogger(server.log);
    setInterval(() => {
      runAllCleanupTasks(undefined, cleanupLogger).catch(err => {
        server.log.error(err, 'Scheduled cleanup failed');
      });
    }, 6 * 60 * 60 * 1000); // Every 6 hours
    // Run once on startup (delayed 60s to let DB connections settle)
    setTimeout(() => {
      runAllCleanupTasks(undefined, cleanupLogger).catch(err => {
        server.log.error(err, 'Initial cleanup failed');
      });
    }, 60_000);

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
      }
    }, 6 * 60 * 60 * 1000); // Every 6 hours

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
    // Stop the escalation cron
    stopEscalationCron();

    // Stop workers (wait for in-progress jobs)
    console.log("⏳ Stopping workers...");
    await Promise.all([
      stopWorker(),
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
