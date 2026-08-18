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
// stacks (tailwind.config.js).
//
// ⚠️ The rest of this note used to claim it therefore "renders only for glyphs
// Cairo lacks". Measured in a real browser on 2026-08-18, that is NOT what
// happens: Cairo covers every glyph at every weight 300–900 on both locales
// (`document.fonts.check()` true for Latin and Arabic throughout, and no
// element reported an uncovered character), yet FOUR tajawal files — weights
// 500 and 700, Arabic + Latin — still reach status `loaded` on /ar AND /en,
// arriving 14.5–23 s in at Slow 3G. Why they are requested at all is UNKNOWN;
// the leading guess is weight matching (Cairo is declared `300 700` and the
// page has weight-800 text), but that was not confirmed. Do not restate the
// old claim without re-measuring — it is contradicted by the only measurement
// anyone has taken.
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
//
// preload: false — it cannot render today, so preloading it was pure cost.
// `font-display` in tailwind.config.js is [cairo, outfit, …]: Cairo comes
// FIRST, and Cairo covers every glyph at every weight 300–900 (measured in a
// real browser 2026-08-18 on both /ar and /en — `document.fonts.check()`
// returned true for Latin and Arabic at all seven weights, and the outfit
// FontFace stayed `unloaded` on both locales). A later family in a stack only
// renders glyphs the earlier ones lack, so Outfit never gets reached.
//
// It stayed in <head> as a 32.5 kB preload competing with the render-blocking
// stylesheet on every page — 24–32% of the bytes ahead of first paint were
// fonts. Removing the preload changes nothing visually, because nothing is
// rendered in Outfit today.
//
// ⚠️ That is also a DESIGN bug, deliberately not fixed here: someone chose
// Outfit as the heading font and it has never been used. Putting it ahead of
// Cairo in the `display` stack would change how every heading in the product
// looks — an identity decision, not a performance one. If that happens, this
// preload must come back.
export const outfit = localFont({
    src: '../../public/fonts/outfit-latin.woff2',
    weight: '400 900',
    display: 'swap',
    preload: false,
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
