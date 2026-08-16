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
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_WHATSAPP_CONFIG_ID
ARG NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY
ARG NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT
ARG NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED
ARG NEXT_PUBLIC_PHONE_AUTH_ENABLED
ARG NEXT_PUBLIC_CHECKOUT_MAINTENANCE
ARG SEMANTIC_VERSION

ENV NEXT_PUBLIC_FB_APP_ID=$NEXT_PUBLIC_FB_APP_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=$NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_WHATSAPP_CONFIG_ID=$NEXT_PUBLIC_WHATSAPP_CONFIG_ID
ENV NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY=$NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY
ENV NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT=$NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT
ENV NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED=$NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED
ENV NEXT_PUBLIC_PHONE_AUTH_ENABLED=$NEXT_PUBLIC_PHONE_AUTH_ENABLED
ENV NEXT_PUBLIC_CHECKOUT_MAINTENANCE=$NEXT_PUBLIC_CHECKOUT_MAINTENANCE
ENV NEXT_PUBLIC_APP_VERSION=$SEMANTIC_VERSION

# Guard: a missing NEXT_PUBLIC_* has NO runtime repair.
#
# Next.js inlines these at `next build`, so an arg the caller forgot to pass is
# constant-folded to `undefined` and the feature dies inside the image —
# env_file at runtime cannot fix it. On 2026-08-02 the blue/green compose
# overlays never passed NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, so
# `getStripePromise()` compiled to `return null`, the PaymentElement could not
# mount for ANY merchant, and checkout showed an empty payment section — with no
# runtime error anywhere (NEXT_PUBLIC_SENTRY_DSN was missing from the same list,
# so the frontend could not even report it).
#
# A missing payment key must break the BUILD, never production. Images that
# genuinely have no key (local smoke builds) pass ALLOW_MISSING_PUBLIC_ENV=1.
ARG ALLOW_MISSING_PUBLIC_ENV=
RUN if [ -z "$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" ] && [ "$ALLOW_MISSING_PUBLIC_ENV" != "1" ]; then \
        echo "❌ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is empty — checkout would ship dead."; \
        echo "   Pass it as a build arg (see docker-compose*.yml 'frontend*' services)"; \
        echo "   and make sure it is set in env/frontend.env on the host."; \
        echo "   For a build that intentionally has no payments: ALLOW_MISSING_PUBLIC_ENV=1"; \
        exit 1; \
    fi; \
    for v in NEXT_PUBLIC_SENTRY_DSN NEXT_PUBLIC_GA_ID; do \
        eval "val=\$$v"; \
        [ -n "$val" ] || echo "⚠️  $v is empty — that surface will be dark in this image."; \
    done

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
