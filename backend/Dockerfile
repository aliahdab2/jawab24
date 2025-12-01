FROM node:18-alpine AS builder
WORKDIR /app

# Copy root config and workspaces
COPY package.json package-lock.json ./
COPY packages/shared ./packages/shared
COPY backend ./backend

# Install & Build
RUN npm ci
RUN npm run build --workspace=@jawab24/shared
RUN npm run build --workspace=jawab24-backend

# Generate migrations
RUN npm run generate --workspace=jawab24-backend

# Prune dev dependencies
RUN npm prune --omit=dev

# Production Stage
FROM node:18-alpine AS production
WORKDIR /app
RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/backend ./backend

WORKDIR /app/backend
RUN chown -R nodejs:nodejs /app
USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]