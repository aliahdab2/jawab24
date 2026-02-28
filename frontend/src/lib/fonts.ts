/**
 * Google Font definitions loaded via `next/font/google`.
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
import { DM_Sans, Cairo, Tajawal, Outfit, JetBrains_Mono } from 'next/font/google';

// English font
export const dmSans = DM_Sans({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    display: 'swap',
    variable: '--font-dm-sans',
});

// Arabic fonts
export const cairo = Cairo({
    subsets: ['arabic'],
    weight: ['300', '400', '500', '600', '700'],
    display: 'swap',
    variable: '--font-cairo',
});

export const tajawal = Tajawal({
    subsets: ['arabic'],
    weight: ['300', '400', '500', '700'],
    display: 'swap',
    variable: '--font-tajawal',
});

// Display font (headings)
export const outfit = Outfit({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700', '800', '900'],
    display: 'swap',
    variable: '--font-outfit',
});

// Monospace font (code blocks, IDs)
export const jetbrainsMono = JetBrains_Mono({
    subsets: ['latin'],
    weight: ['400', '500', '600'],
    display: 'swap',
    variable: '--font-jetbrains-mono',
});
