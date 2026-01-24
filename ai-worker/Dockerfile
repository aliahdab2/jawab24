FROM node:18-alpine AS builder
WORKDIR /app

# Copy only manifests first to cache dependencies
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY ai-worker/package.json ./ai-worker/

# Install dependencies (Cached unless package.json changes)
RUN npm ci

# Copy source code
COPY packages/shared ./packages/shared
COPY ai-worker ./ai-worker

# Build
RUN npm run build --workspace=@jawab24/shared
RUN npm run build --workspace=jawab24-ai-worker

RUN npm prune --omit=dev

# Production
FROM node:18-alpine AS production
WORKDIR /app
RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy artifacts
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/ai-worker ./ai-worker

WORKDIR /app/ai-worker
RUN chown -R nodejs:nodejs /app
USER nodejs
EXPOSE 3002
ENV NODE_ENV=production
ENV PORT=3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3002/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]