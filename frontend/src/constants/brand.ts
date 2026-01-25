/**
 * Centralized Brand Asset Management
 * Use these constants throughout the app to ensure consistency and make future updates easy.
 */

// Base URL from environment or default to production
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://jawab24.com';

export const BRAND_ASSETS = {
    logo: {
        small: '/brand/logo-small.png',
        large: '/brand/logo-large.png',
        main: '/brand/logo-main.svg?v=3',
        mainRtl: '/brand/logo-main-rtl.svg?v=3',
        vector: '/brand/icon-vector.svg?v=3',
    },
    seo: {
        ogSocial: '/brand/og-social.png',
        favicon16: '/brand/favicon-16x16.png',
        favicon32: '/brand/favicon-32x32.png',
        appleTouch: '/brand/apple-touch-icon.png',
        faviconIco: '/brand/favicon.ico',
    },
    meta: {
        appName: 'Jawab24',
        appTitle: 'Jawab24 جواب | AI Auto-Reply for Facebook & Instagram',
        themeColor: '#18181b',
    },
    urls: {
        base: SITE_URL,
        canonical: (path: string = '') => `${SITE_URL}${path}`,
        ogImage: (image: string = '/brand/og-social.png') => `${SITE_URL}${image}`,
    },
    social: {
        facebook: 'https://facebook.com/jawab24app',
        instagram: 'https://instagram.com/jawab24',
        twitter: '@jawab24',
    }
};
