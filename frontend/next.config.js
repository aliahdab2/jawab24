/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
    NEXT_PUBLIC_FB_APP_ID: process.env.NEXT_PUBLIC_FB_APP_ID || '',
  },
  // Internationalization configuration
  i18n: {
    locales: ['ar', 'en'],      // Supported languages
    defaultLocale: 'ar',         // Arabic is default
    localeDetection: false,     // Required in Next.js 15
  },
}

module.exports = nextConfig

