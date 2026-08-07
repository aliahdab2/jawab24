import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_ASSETS } from '../brand';
import { CHANNEL_ORDER, type ChannelKey } from '../brandGlyphs';
import enComments from '@/i18n/en/comments.json';
import arComments from '@/i18n/ar/comments.json';
import enMeta from '@/i18n/en/meta.json';
import arMeta from '@/i18n/ar/meta.json';

/**
 * Every surface that describes the PRODUCT to someone who has not signed up yet must name
 * every channel we support.
 *
 * This exists because WhatsApp went GA in July 2026 and these surfaces were never updated:
 * the shared-link preview and the Android install prompt both still said "AI Auto-Reply for
 * Facebook & Instagram" weeks later. Nothing failed, because nothing tied the copy to the
 * channel list — so the drift was invisible until a human shared a link and noticed.
 *
 * Adding a channel to CHANNEL_ORDER now fails this test until the copy catches up.
 *
 * Deliberately NOT covered here: channel-scoped copy that is correct as-is — the privacy
 * policy (Meta API terms), the comments inbox (WhatsApp has no comments), page-connect
 * flows (Facebook Login). Those legitimately name only Facebook and Instagram.
 */

const REPO_FRONTEND = path.resolve(__dirname, '../../..');

/** Localized channel names, read from the `comments` namespace rather than re-typed. */
const CHANNEL_NAME: Record<ChannelKey, { en: string; ar: string }> = {
    whatsapp: { en: enComments.platformWhatsApp, ar: arComments.platformWhatsApp },
    facebook: { en: enComments.platformFacebook, ar: arComments.platformFacebook },
    instagram: { en: enComments.platformInstagram, ar: arComments.platformInstagram },
};

const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_FRONTEND, 'public/manifest.json'), 'utf8'),
) as { name: string; description: string };

/** English surfaces, keyed by what a reader would see them in. */
const ENGLISH_SURFACES: Record<string, string> = {
    'og:title / <title> default (BRAND_ASSETS.meta.appTitle)': BRAND_ASSETS.meta.appTitle,
    'og:description default (meta.json ogDescription)': enMeta.ogDescription,
    'meta description (meta.json description)': enMeta.description,
    'twitter description (meta.json twitterDescription)': enMeta.twitterDescription,
    'PWA install prompt name (manifest.json name)': manifest.name,
    'PWA install prompt description (manifest.json description)': manifest.description,
    'generated social card tagline (BRAND_ASSETS.socialCardTagline.en)': BRAND_ASSETS.socialCardTagline.en,
};

const ARABIC_SURFACES: Record<string, string> = {
    'og:description default AR (meta.json ogDescription)': arMeta.ogDescription,
    'meta description AR (meta.json description)': arMeta.description,
    'twitter description AR (meta.json twitterDescription)': arMeta.twitterDescription,
    'PWA install prompt description AR (manifest.json description)': manifest.description,
    'generated social card tagline AR (BRAND_ASSETS.socialCardTagline.ar)': BRAND_ASSETS.socialCardTagline.ar,
};

describe('channel coverage on product-description surfaces', () => {
    it.each(Object.entries(ENGLISH_SURFACES))('%s names every supported channel (EN)', (_label, copy) => {
        for (const channel of CHANNEL_ORDER) {
            expect(copy).toContain(CHANNEL_NAME[channel].en);
        }
    });

    it.each(Object.entries(ARABIC_SURFACES))('%s names every supported channel (AR)', (_label, copy) => {
        for (const channel of CHANNEL_ORDER) {
            expect(copy).toContain(CHANNEL_NAME[channel].ar);
        }
    });

    it('keeps the default title inside the search-result display budget', () => {
        // appTitle is the <title> and og:title for every page that does not override them,
        // and login.tsx appends to it. Google truncates around 60 chars / 600px. Naming a
        // fourth channel here means shortening something else, not letting it grow.
        expect(BRAND_ASSETS.meta.appTitle.length).toBeLessThanOrEqual(60);
    });

    it('lists WhatsApp first, matching CHANNEL_ORDER', () => {
        // The canonical order is a product decision (newest + highest intent leads).
        // Pinned so the surfaces stay consistent with each other.
        expect(CHANNEL_ORDER).toEqual(['whatsapp', 'facebook', 'instagram']);
    });

    it('generated social images exist at the sizes the meta tags promise', () => {
        // The old card was a 1024x1024 JPEG named .png while og:image:width/height said
        // 1200x630, so scrapers cropped it. PNG header: width/height are big-endian
        // uint32 at byte offsets 16 and 20.
        const readPngSize = (rel: string) => {
            const buf = fs.readFileSync(path.join(REPO_FRONTEND, rel));
            expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
            return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
        };

        expect(readPngSize('public/brand/og-social.png')).toEqual({ width: 1200, height: 630 });
        for (const locale of ['en-US', 'ar']) {
            expect(readPngSize(`android/app/src/main/play/listings/${locale}/graphics/feature-graphic/main.png`))
                .toEqual({ width: 1024, height: 500 });
        }
    });
});
