FROM node:22-alpine AS builder
WORKDIR /app

# Copy only manifests first to cache dependencies
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY frontend/package.json ./frontend/

# Install all dependencies (Cached unless package.json changes)
RUN npm ci --ignore-scripts


# Build arguments for frontend
ARG NEXT_PUBLIC_FB_APP_ID
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
ARG NEXT_PUBLIC_GA_ID
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SEMANTIC_VERSION

ENV NEXT_PUBLIC_FB_APP_ID=$NEXT_PUBLIC_FB_APP_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=$NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_APP_VERSION=$SEMANTIC_VERSION

# Copy source code
COPY packages/shared ./packages/shared
COPY frontend ./frontend

# Build shared and frontend
RUN npm run build --workspace=@jawab24/shared
RUN npm run build --workspace=jawab24-frontend

# Production Stage — standalone output (only traced dependencies, no full node_modules)
FROM node:22-alpine AS production
WORKDIR /app
RUN apk add --no-cache dumb-init wget
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy standalone server (includes only the node_modules files actually needed)
COPY --from=builder --chown=nodejs:nodejs /app/frontend/.next/standalone ./
# Copy static assets (not included in standalone output)
COPY --from=builder --chown=nodejs:nodejs /app/frontend/.next/static ./frontend/.next/static
# Copy public folder (if it exists)
COPY --from=builder --chown=nodejs:nodejs /app/frontend/public ./frontend/public

USER nodejs

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001 || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "frontend/server.js"]
