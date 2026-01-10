/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standard Server Config (no static export)
  outputFileTracingRoot: path.join(__dirname, '../'),
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api',
    NEXT_PUBLIC_FB_APP_ID: process.env.NEXT_PUBLIC_FB_APP_ID || '',
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || 'https://jawab24.com',
  },
  
  // Internationalization configuration
  i18n: {
    locales: ['ar', 'en'],      // Supported languages
    defaultLocale: 'ar',        // Arabic is default
    localeDetection: false,     // Required in Next.js 15
  },

  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
