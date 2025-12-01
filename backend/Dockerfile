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

# Production Stage
FROM node:18-alpine AS production
WORKDIR /app
RUN apk add --no-cache dumb-init wget
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

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
