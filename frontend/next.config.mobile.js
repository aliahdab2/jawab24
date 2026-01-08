/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mobile specific settings
  output: 'export',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  
  // Standard settings carried over
  outputFileTracingRoot: path.join(__dirname, '../'),
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api',
    NEXT_PUBLIC_FB_APP_ID: process.env.NEXT_PUBLIC_FB_APP_ID || '774211662298446',
    NEXT_PUBLIC_IS_MOBILE: 'true',
  },
  
  // Explicitly disable i18n for mobile builds
  // (Next.js 15+ static export doesn't support i18n routing)
  i18n: null,

  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
