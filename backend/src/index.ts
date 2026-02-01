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
import Redis from "ioredis";
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
import { errorHandler } from "./middleware/errorHandler";
import { requestIdMiddleware } from "./middleware/requestId";
import { validateEnv } from "./utils/env";
import { redis } from "./lib/redis";
import { startWorker, stopWorker, setWorkerLogger } from "./workers/replyWorker";
import { createRequestLogger } from "./types";
import { config } from "./config";
import demoPlugin from "./plugins/demo";
import { ensureAdminUsers } from "./utils/adminSetup";

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
    level: process.env.LOG_LEVEL || "info",
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          headers: request.headers,
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

// Add rawBody support for Stripe webhooks
server.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (req, body, done) => {
    try {
      (req as any).rawBody = body;
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

    // Register plugins
    // CORS: Environment-based origin configuration
    // - Production: Allow FRONTEND_URL and mobile app origins
    // - Development: Allow localhost ports
    const isProduction = process.env.NODE_ENV === "production";
    const mobileOrigins = [
      "capacitor://localhost",
      "http://localhost",
      "https://localhost",
      "com.jawab24.app",
    ];

    const allowedOrigins = isProduction
      ? [process.env.FRONTEND_URL || "https://jawab24.com", ...mobileOrigins]
      : ["http://localhost:3000", "http://localhost:3001", ...mobileOrigins];

    await server.register(cors, {
      origin: allowedOrigins,
      credentials: true,
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

    // Register health and version routes BEFORE rate limit to exempt them
    await server.register(healthRoutes);
    await server.register(versionRoutes);

    // Register cookie plugin
    // COOKIE_SECRET is validated at startup via validateEnv() - no fallback needed
    await server.register(cookie, {
        secret: process.env.COOKIE_SECRET!,
        hook: 'onRequest',
        parseOptions: {}
    });

    // Register rate limiting
    // Use Redis for rate limiting to ensure consistency across blue/green deployments
    const redisClient = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
    });

    await server.register(rateLimit, {
      max: 2000, // 2000 requests per 15 minutes
      timeWindow: "15 minutes",
      redis: redisClient,
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

    const port = parseInt(process.env.PORT || "3000", 10);
    const host = "0.0.0.0";

    await server.listen({ port, host });
    console.log(`🚀 Server listening on http://${host}:${port}`);
    console.log(`📊 Health check: http://${host}:${port}/health`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);

    // Ensure admin users are set up from environment variables
    await ensureAdminUsers();

    // Start the reply processing worker
    // Create a logger adapter for the worker
    const workerLogger = createRequestLogger(server.log);
    startWorker(workerLogger);
    console.log(`⚙️  Reply processing worker started`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  console.log(`\n${signal} received, closing server gracefully...`);

  try {
    // Stop the reply worker first (wait for in-progress jobs)
    console.log("⏳ Stopping reply worker...");
    await stopWorker();
    console.log("✅ Reply worker stopped");

    await server.close();
    await redis.quit();
    console.log("✅ Server closed successfully");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error during shutdown:", err);
    process.exit(1);
  }
};

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("UNHANDLED_REJECTION");
});

start();
