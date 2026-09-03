/**
 * Tests: brandLogo
 *
 * The point of this file is the parity assertion. `BRAND_ICON_SVG` is a COPY of
 * a frontend asset — the backend image has no access to frontend/public — and a
 * copied asset drifts silently. A rebrand that updates the real file and
 * forgets this one would ship invoices carrying the old mark, and nobody would
 * notice until a customer had it in their inbox.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BRAND_ICON_SVG, brandLogoDataUri } from '../utils/brandLogo';

/** backend/src/__tests__ → repo root → the real asset. */
const SOURCE_SVG = join(__dirname, '../../../frontend/public/brand/icon-vector.svg');

describe('brandLogo', () => {
    it('is byte-identical to the frontend brand asset it copies', () => {
        const original = readFileSync(SOURCE_SVG, 'utf8');
        // Compared with whitespace normalised at line ends only: the copy lives
        // in a template literal, so an editor's trailing-whitespace trim must
        // not be able to fail the build, while any real content change does.
        const normalise = (s: string) => s.replace(/[ \t]+$/gm, '').trimEnd();
        expect(normalise(BRAND_ICON_SVG)).toBe(normalise(original));
    });

    it('produces a base64 data URI a browser will accept', async () => {
        const uri = await brandLogoDataUri();
        expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
        // Percent-encoding would have left these raw and broken the attribute.
        expect(uri).not.toContain('#');
        expect(uri).not.toContain('"');
        expect(uri).not.toContain('<');
    });

    it('round-trips back to the original SVG', async () => {
        const uri = await brandLogoDataUri();
        const decoded = Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
        expect(decoded).toBe(BRAND_ICON_SVG);
        expect(decoded).toContain('<svg');
    });
});
