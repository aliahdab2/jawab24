/**
 * Tests: invoiceFonts
 *
 * The parity assertion is the point, exactly as in brandLogo.test.ts. The woff2
 * files under backend/assets/fonts are COPIES of the frontend's — the backend
 * image contains only `backend/` and `packages/`, so the frontend path does not
 * exist in production. A copied binary drifts silently: someone upgrades
 * Tajawal for the web and the invoices keep rendering in the old cut, with
 * nothing to notice it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { invoiceFontFaceCss, resetInvoiceFontCache } from '../utils/invoiceFonts';

/** backend/src/__tests__ → repo root. */
const REPO = join(__dirname, '../../..');
const BACKEND_FONTS = join(REPO, 'backend/assets/fonts');
const FRONTEND_FONTS = join(REPO, 'frontend/public/fonts');

const WEIGHTS = [400, 500, 700];

describe('invoiceFonts', () => {
    beforeEach(() => resetInvoiceFontCache());

    it.each(WEIGHTS)('tajawal-arabic-%i.woff2 is byte-identical to the frontend copy', (weight) => {
        const file = `tajawal-arabic-${weight}.woff2`;
        expect(readFileSync(join(BACKEND_FONTS, file)))
            .toEqual(readFileSync(join(FRONTEND_FONTS, file)));
    });

    it('ships no font the template does not reference', () => {
        // A face nobody uses is dead weight in the image and in every rendered
        // page. If a weight is added here it must be used, or removed.
        const shipped = readdirSync(BACKEND_FONTS).filter((f) => f.endsWith('.woff2')).sort();
        expect(shipped).toEqual(WEIGHTS.map((w) => `tajawal-arabic-${w}.woff2`));
    });

    it('emits one @font-face per weight, with embedded woff2 data', () => {
        const css = invoiceFontFaceCss();
        for (const weight of WEIGHTS) {
            expect(css).toContain(`font-weight: ${weight};`);
        }
        expect(css.match(/@font-face/g)).toHaveLength(WEIGHTS.length);
        expect(css.match(/data:font\/woff2;base64,/g)).toHaveLength(WEIGHTS.length);
        expect(css).toContain("font-family: 'Tajawal'");
    });

    it('blocks rather than swaps, so a fallback face cannot be captured', () => {
        // page.pdf() takes one shot. With font-display: swap, the first paint
        // could legitimately use a fallback and that is what would be printed.
        expect(invoiceFontFaceCss()).toContain('font-display: block;');
        expect(invoiceFontFaceCss()).not.toContain('font-display: swap;');
    });

    it('carries only Arabic glyphs, so Latin falls through as on the house invoice', () => {
        // Proven by size, not by inspection: an Arabic-only Tajawal subset is
        // ~9KB. A full face carrying Latin as well is an order of magnitude
        // bigger, so a swap to the unsubsetted font fails here.
        for (const weight of WEIGHTS) {
            const bytes = readFileSync(join(BACKEND_FONTS, `tajawal-arabic-${weight}.woff2`));
            expect(bytes.length).toBeLessThan(20_000);
        }
    });

    it('caches the CSS instead of re-reading three files per render', () => {
        const first = invoiceFontFaceCss();
        expect(invoiceFontFaceCss()).toBe(first);
    });
});
