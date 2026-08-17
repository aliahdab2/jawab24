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
    adjustFontFallback: 'Arial',
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
//
// preload: false — deliberately. Tajawal has NO utility class of its own; it is
// only the second fallback behind Cairo in the `font-sans` / `font-arabic`
// stacks (tailwind.config.js), so it renders only for glyphs Cairo lacks.
// next/font preloads EVERY declared src file by default, which put these
// 8 files (73.4 kB) ahead of the render-blocking stylesheet in <head> — at
// Slow 3G that alone delayed first paint by seconds (measured 2026-08-17:
// CSS was 15th in line, first paint 16.2 s). With `display: 'swap'` the files
// still load on demand if a Cairo-missing glyph ever needs them.
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
    preload: false,
    variable: '--font-tajawal',
});

// Display / heading font (variable font — single file covers weights 400–900)
export const outfit = localFont({
    src: '../../public/fonts/outfit-latin.woff2',
    weight: '400 900',
    display: 'swap',
    variable: '--font-outfit',
    adjustFontFallback: 'Arial',
});

// Monospace font (variable font — single file covers weights 400–600)
//
// preload: false — `font-mono` appears nowhere on the landing / pricing /
// login / blog-index pages; its public uses (404, /instagram, GDPR status,
// e-commerce onboarding) tolerate a swap. See the tajawal comment above for
// why every preload ahead of the stylesheet costs first paint on slow links.
export const jetbrainsMono = localFont({
    src: '../../public/fonts/jetbrains-mono-latin.woff2',
    weight: '400 600',
    display: 'swap',
    preload: false,
    variable: '--font-jetbrains-mono',
});
