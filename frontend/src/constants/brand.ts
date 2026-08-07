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
        appTitle: 'Jawab24 جواب | AI Auto-Reply for WhatsApp, Facebook & Instagram',
        themeColor: '#18181b',
    },
    /** Bilingual tagline burned into the generated social card and Play feature graphic
        by `scripts/generate-social-images.ts`. Kept here (not in the script) so the
        channel-coverage test can assert it — an image cannot be grepped. */
    socialCardTagline: {
        en: 'Smart AI Auto-Replies for WhatsApp, Facebook & Instagram',
        // Deliberately tighter than the English: Cairo sets wider than Outfit, and naming
        // three channels has to fit the same column. Also drops the old art's «الجيل الجديد
        // من الردود التلقائية» ("the new generation of automatic replies") for a direct
        // rendering of the English line.
        ar: 'ردود تلقائية ذكية لواتساب وفيسبوك وإنستغرام',
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
    },
    stores: {
        googlePlay: 'https://play.google.com/store/apps/details?id=com.jawab24.android',
    }
};
