/**
 * Tajawal, embedded into the invoice HTML as `@font-face` data URIs.
 *
 * ## Why the font is embedded rather than installed
 *
 * The house invoice (JW24-2026-0001) is set in **Tajawal** — that is not a
 * guess: the PDF's own font table lists `Tajawal-Regular/Medium/Bold` for the
 * Arabic and `Helvetica` for the Latin, with `Producer: Skia/PDF`, i.e. it was
 * printed from a browser on a Mac where Tajawal was available.
 *
 * Production is Alpine, which ships only the Noto faces. Rendering there
 * without embedding gives Noto Naskh — a completely different, calligraphic
 * face — so the invoice would silently stop looking like our invoice. Three
 * options were possible: install Tajawal in the image, rely on fontconfig, or
 * embed. Embedding wins for one reason that outranks the others: **an archived
 * financial document must reproduce identically years later**, and a font
 * resolved from the host is a dependency on whatever that host has installed
 * that year.
 *
 * ## Only the Arabic subsets
 *
 * Latin deliberately falls through to the system sans, exactly as it does on
 * the house invoice: these subsets contain no Latin glyphs, so "790.00 USD"
 * lands on the next family in the stack. Reproducing the original means
 * reproducing that fall-through, not overriding it.
 *
 * ~27 KB for three weights, and Chromium subsets again on the way into the PDF,
 * so the output stays small.
 *
 * ## Drift
 *
 * These files are COPIES of `frontend/public/fonts/tajawal-arabic-*.woff2` —
 * the backend image contains only `backend/` and `packages/`, so the frontend's
 * path does not exist in production. `invoiceFonts.test.ts` asserts the copies
 * are byte-identical to the originals, so a font upgrade on one side fails the
 * suite instead of shipping two different-looking invoices.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/** Weights the template actually uses: body, meta values, headings. */
const WEIGHTS = [400, 500, 700] as const;

/**
 * Where the woff2 files live, probed rather than assumed because `__dirname`
 * differs between the compiled server (`backend/dist`) and a dev/test run
 * through tsx (`backend/src/utils`). Same reasoning as the Chromium probe in
 * services/invoicePdf.ts.
 */
function resolveFontDir(): string {
    const candidates = [
        join(__dirname, '..', 'assets', 'fonts'),        // dist/  → backend/assets/fonts
        join(__dirname, '..', '..', 'assets', 'fonts'),  // src/utils → backend/assets/fonts
    ];
    const found = candidates.find((dir) => existsSync(join(dir, 'tajawal-arabic-400.woff2')));
    if (!found) {
        throw new Error(`Tajawal woff2 files not found. Looked in: ${candidates.join(', ')}`);
    }
    return found;
}

/**
 * Read once, keep the CSS. Invoices are rare, but a render should not pay three
 * file reads and three base64 encodings every time, and the bytes cannot change
 * under a running process.
 */
let cachedCss: string | null = null;

export function invoiceFontFaceCss(): string {
    if (cachedCss !== null) return cachedCss;

    const dir = resolveFontDir();
    cachedCss = WEIGHTS.map((weight) => {
        const b64 = readFileSync(join(dir, `tajawal-arabic-${weight}.woff2`)).toString('base64');
        // `font-display: block` rather than `swap`: this renders once, offline,
        // into a document nobody can re-flow. A swap would let the first paint
        // use a fallback face, and page.pdf() could capture exactly that.
        return `@font-face {
    font-family: 'Tajawal';
    font-style: normal;
    font-weight: ${weight};
    font-display: block;
    src: url(data:font/woff2;base64,${b64}) format('woff2');
  }`;
    }).join('\n  ');

    return cachedCss;
}

/** Test seam: the cache would otherwise outlive a fixture change. */
export function resetInvoiceFontCache(): void {
    cachedCss = null;
}
