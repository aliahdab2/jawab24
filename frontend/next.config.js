/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');

const isMobile = process.env.IS_MOBILE_BUILD === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standard Server Config (no static export)
  outputFileTracingRoot: path.join(__dirname, '../'),
  reactStrictMode: true,
  // Enable static export for mobile builds (puts files in 'out' folder for Capacitor)
  output: isMobile ? 'export' : undefined,

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
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
