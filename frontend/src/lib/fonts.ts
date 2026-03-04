/**
 * Self-hosted font definitions loaded via `next/font/local`.
 *
 * Font files are in `public/fonts/` (downloaded from Google Fonts).
 * No network request is made at build time — builds work offline.
 *
 * Each export exposes a CSS `variable` for use in Tailwind (`font-sans`, `font-display`, etc.):
 * - `dmSans`        — Body text (English), `--font-dm-sans`
 * - `cairo`         — Body text (Arabic), `--font-cairo`
 * - `tajawal`       — Alternate Arabic, `--font-tajawal`
 * - `outfit`        — Headings / display, `--font-outfit`
 * - `jetbrainsMono` — Code / monospace, `--font-jetbrains-mono`
 *
 * All fonts use `display: 'swap'` for fast rendering without FOIT.
 */
import localFont from 'next/font/local';

// English body font (variable font — single file covers weights 400–700)
export const dmSans = localFont({
    src: '../../public/fonts/dm-sans-latin.woff2',
    weight: '400 700',
    display: 'swap',
    variable: '--font-dm-sans',
});

// Arabic body font (variable font — single file covers weights 300–700)
export const cairo = localFont({
    src: [
        { path: '../../public/fonts/cairo-arabic.woff2', weight: '300 700' },
        { path: '../../public/fonts/cairo-latin.woff2', weight: '300 700' },
    ],
    display: 'swap',
    variable: '--font-cairo',
});

// Alternate Arabic font (static per-weight files)
export const tajawal = localFont({
    src: [
        { path: '../../public/fonts/tajawal-arabic-300.woff2', weight: '300' },
        { path: '../../public/fonts/tajawal-latin-300.woff2', weight: '300' },
        { path: '../../public/fonts/tajawal-arabic-400.woff2', weight: '400' },
        { path: '../../public/fonts/tajawal-latin-400.woff2', weight: '400' },
        { path: '../../public/fonts/tajawal-arabic-500.woff2', weight: '500' },
        { path: '../../public/fonts/tajawal-latin-500.woff2', weight: '500' },
        { path: '../../public/fonts/tajawal-arabic-700.woff2', weight: '700' },
        { path: '../../public/fonts/tajawal-latin-700.woff2', weight: '700' },
    ],
    display: 'swap',
    variable: '--font-tajawal',
});

// Display / heading font (variable font — single file covers weights 400–900)
export const outfit = localFont({
    src: '../../public/fonts/outfit-latin.woff2',
    weight: '400 900',
    display: 'swap',
    variable: '--font-outfit',
});

// Monospace font (variable font — single file covers weights 400–600)
export const jetbrainsMono = localFont({
    src: '../../public/fonts/jetbrains-mono-latin.woff2',
    weight: '400 600',
    display: 'swap',
    variable: '--font-jetbrains-mono',
});
