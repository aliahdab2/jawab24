FROM node:22-alpine AS builder
WORKDIR /app

# Build argument for git commit (passed during docker build)
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}

# Copy only manifests first to cache dependencies
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/

# Install dependencies (Cached unless package.json changes)
RUN npm ci --ignore-scripts

# Copy source code
COPY packages/shared ./packages/shared
COPY backend ./backend

# Build
RUN npm run build --workspace=@jawab24/shared
# Explicit heap for the backend build (lint + type-check + tsc): drizzle-orm
# 0.45's type inference pushed peak tsc memory past Node's heuristic default
# (half of host RAM, capped) on the 4-core production host — OOM'd the
# 2026-08-02 deploy. 3 GB is deliberate headroom, not a measured minimum.
RUN NODE_OPTIONS=--max-old-space-size=3072 npm run build --workspace=jawab24-backend

# Remove dev dependencies to reduce image size (~200-300MB savings)
RUN npm prune --omit=dev

# Production Stage
FROM node:22-alpine AS production
WORKDIR /app
# fontconfig + font-noto-arabic: sharp/librsvg typesets the Arabic post-card
# headline via fontconfig at RUNTIME (services/imageCompose.ts) — a bare
# alpine has ZERO fonts, so without these every generated card ships its
# text layer as tofu/blank. Fonts only, no doc packages; the builder stage
# does not need them (nothing renders at build time).
RUN apk add --no-cache dumb-init wget fontconfig font-noto-arabic
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Get GIT_COMMIT from builder stage
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}

# Copy the entire monorepo structure
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/backend ./backend

WORKDIR /app/backend
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
# Run migrations (will skip if no drizzle folder) then start the server
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
