FROM node:18-alpine AS builder
WORKDIR /app

# Copy root config and workspaces
COPY package.json package-lock.json ./
COPY packages/shared ./packages/shared
COPY frontend ./frontend

# Install all dependencies
RUN npm ci

# Build arguments
ARG NEXT_PUBLIC_FB_APP_ID
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_FB_APP_ID=$NEXT_PUBLIC_FB_APP_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Build shared and frontend
RUN npm run build --workspace=@jawab24/shared
RUN npm run build --workspace=jawab24-frontend

# Production Stage
FROM node:18-alpine AS production
WORKDIR /app
RUN apk add --no-cache dumb-init wget
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy the entire monorepo structure needed for Next.js
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/frontend ./frontend

WORKDIR /app/frontend
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001 || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node_modules/.bin/next", "start", "-p", "3001"]
