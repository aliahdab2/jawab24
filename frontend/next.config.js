/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const { withSentryConfig } = require('@sentry/nextjs');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const isMobile = process.env.IS_MOBILE_BUILD === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standard Server Config (no static export)
  outputFileTracingRoot: path.join(__dirname, '../'),
  reactStrictMode: true,
  // Mobile: static export for Capacitor; Production: standalone for minimal Docker images
  output: isMobile ? 'export' : 'standalone',
  // Separate build directories per output mode to prevent stale artifact conflicts
  // (standalone expects pages-manifest.json; export doesn't generate it)
  distDir: isMobile ? '.next-mobile' : '.next',

  images: {
    unoptimized: isMobile,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ui-avatars.com',
        port: '',
        pathname: '/api/**',
      },
    ],
  },

  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api',
    NEXT_PUBLIC_FB_APP_ID: process.env.NEXT_PUBLIC_FB_APP_ID || '774211662298446',
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || 'https://jawab24.com',
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  
  // Internationalization configuration
  // DISABLE i18n for mobile static export (Capacitor doesn't support server-based i18n routing)
  // Client-side i18n (in hooks.ts) will handle fallback to Zustand store.
  i18n: isMobile ? undefined : {
    locales: ['ar', 'en'],      // Supported languages
    defaultLocale: 'ar',        // Arabic is default
    localeDetection: false,     // Required in Next.js 15
  },

  eslint: {
    ignoreDuringBuilds: false,
  },

  async redirects() {
    return [
      // /landing → / (canonical landing page is now at root)
      // Next.js i18n automatically handles locale: /en/landing → /en/
      {
        source: '/landing',
        destination: '/',
        permanent: true,
      },
    ];
  },

  async rewrites() {
    // Serve the IndexNow key-verification file at /<key>.txt (Bing / Copilot /
    // ChatGPT Search / Yandex discovery). The pattern matches any long token and
    // routes to the API route, which validates the requested key against the
    // RUNTIME env (INDEXNOW_KEY) and 404s otherwise — so this does NOT depend on
    // INDEXNOW_KEY being present at build time. Static public .txt files (robots,
    // llms, llms-full) are served before afterFiles rewrites, so they are
    // unaffected. No-op for the mobile static export.
    if (isMobile) return [];
    return [
      {
        source: '/:indexnowKey([A-Za-z0-9-]{8,}).txt',
        destination: '/api/indexnow-key?key=:indexnowKey',
        locale: false,
      },
    ];
  },

  async headers() {
    return [
      // Static brand assets — immutable, cached for 1 year
      {
        source: '/brand/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      // Font files — immutable, cached for 1 year
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      // LLM discovery files — cache 1 day, serve stale for 1 week
      {
        source: '/llms:path(.*).txt',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
      },
      // Public pages — cache 1 hour, serve stale for 1 day
      {
        source: '/:locale(en|ar)?/:page(landing|pricing|login|what-is-jawab24|compare/:slug*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' }],
      },
      // Blog pages — cache 1 day, serve stale for 1 week (content changes rarely)
      {
        source: '/:locale(en|ar)?/blog/:slug*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
      },
    ];
  },

  webpack: (config, { webpack }) => {
    // Mobile builds need the native useMobileMessages that statically imports
    // all i18n namespaces for client-side language switching. Web builds get
    // the stub (returns null), which keeps ~150 kB of namespace JSONs out of
    // the client bundle.
    //
    // NormalModuleReplacementPlugin rewrites at module-request time, after
    // tsconfig path mapping has resolved `@/...` aliases — a plain
    // `resolve.alias` entry would miss because the request no longer matches.
    if (isMobile) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]hooks[\\/]useMobileMessages(\.ts)?$/,
          (resource) => {
            if (!resource.request.includes('.native')) {
              resource.request = resource.request.replace(
                /useMobileMessages(\.ts)?$/,
                'useMobileMessages.native$1',
              );
            }
          },
        ),
      );
    }
    return config;
  },
}

// Sentry configuration
const sentryWebpackPluginOptions = {
  // Suppresses source map uploading logs during build
  silent: true,

  // Upload source maps only in production
  disableServerWebpackPlugin: process.env.NODE_ENV !== 'production',
  disableClientWebpackPlugin: process.env.NODE_ENV !== 'production',

  // Hide source maps from users
  hideSourceMaps: true,

  // Automatically tree-shake Sentry logger statements
  disableLogger: true,
};

// Wrap with Sentry only if DSN is configured, then with bundle analyzer
const configWithSentry = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;

module.exports = withBundleAnalyzer(configWithSentry);
