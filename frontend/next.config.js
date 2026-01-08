const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../'),
  reactStrictMode: true,
  output: 'export', // Required for Capacitor
  trailingSlash: true, // Recommended for static mapping
  images: {
    unoptimized: true, // Required for static export
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
    NEXT_PUBLIC_FB_APP_ID: process.env.NEXT_PUBLIC_FB_APP_ID || '',
  },
  // i18n removed for static export compatibility
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig

