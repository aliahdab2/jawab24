import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_ASSETS } from '@/constants/brand';
import { CHANNEL_BRAND_HEX, CHANNEL_GLYPH_PATHS, CHANNEL_ORDER } from '@/constants/brandGlyphs';
import { LOCK_PATH, TARGETS, computeInputHash, hashBytes, rtlLine, verticalPadding } from '../../scripts/lib/socialCard';

const FRONTEND = path.resolve(__dirname, '../..');
const SOURCE_ART = path.join(FRONTEND, 'scripts/assets/social-base-source.png');

describe('rtlLine', () => {
    it('reverses word order so satori lays the line out right-to-left', () => {
        // Satori 0.25 has no bidi pass: it emits one flex item per word in source order.
        const node = rtlLine('ردود تلقائية ذكية', 20);
        const words = node.props.children.map((c) => c.props.children);
        expect(words).toEqual(['ذكية', 'تلقائية', 'ردود']);
    });

    it('never wraps — an over-long line must overflow visibly, not scramble silently', () => {
        // Wrapping would invert visual LINE order on top of word order, producing a
        // plausible-looking but wrong sentence. Overflow is the loud failure we want.
        expect(rtlLine('ردود تلقائية', 20).props.style.flexWrap).toBe('nowrap');
    });

    it.each([
        ['Latin', 'ردود Jawab24 ذكية'],
        ['ASCII digits', 'ردود 24 ذكية'],
        ['Arabic-Indic digits', 'ردود ٢٤ ذكية'],
        ['Extended Arabic-Indic digits', 'ردود ۲۴ ذكية'],
    ])('throws on %s, which word reversal cannot place', (_label, text) => {
        expect(() => rtlLine(text, 20)).toThrow(/cannot place those correctly/);
    });
});

describe('verticalPadding', () => {
    it('adds no padding when the target already matches the base aspect', () => {
        expect(verticalPadding(1024, 500)).toMatchObject({ total: 0, top: 0, bottom: 0 });
    });

    it('extends symmetrically to reach a taller aspect', () => {
        const { total, top, bottom } = verticalPadding(1200, 630);
        expect(total).toBe(38);
        expect(top + bottom).toBe(total);
        expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
    });
});

/**
 * The committed PNGs are build output. Without this gate, changing a tagline and forgetting
 * to run `npm run social:generate` ships an image that contradicts its own source of truth —
 * the exact defect the generator exists to prevent, reintroduced one level up.
 *
 * Verified to fail: adding a channel to socialCardTagline.ar without regenerating trips the
 * inputHash assertion.
 */
describe('generated social images are in sync with their sources', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(FRONTEND, LOCK_PATH), 'utf8')) as {
        inputHash: string;
        outputs: Record<string, string>;
        channels: string[];
    };

    it('lock matches the current taglines, channel list, glyphs and source artwork', () => {
        const current = computeInputHash({
            sourceArt: fs.readFileSync(SOURCE_ART),
            taglineEn: BRAND_ASSETS.socialCardTagline.en,
            taglineAr: BRAND_ASSETS.socialCardTagline.ar,
            channelOrder: CHANNEL_ORDER,
            channelHex: CHANNEL_BRAND_HEX,
            channelPaths: CHANNEL_GLYPH_PATHS,
        });
        expect(
            current === lock.inputHash ? true : `stale — run \`npm run social:generate\` and commit the result`,
        ).toBe(true);
    });

    it.each(TARGETS.map((t) => t.out))('%s matches the hash recorded at generation time', (out) => {
        const actual = hashBytes(fs.readFileSync(path.join(FRONTEND, out)));
        expect(actual).toBe(lock.outputs[out]);
    });

    it('records the channel list the images were drawn with', () => {
        expect(lock.channels).toEqual([...CHANNEL_ORDER]);
    });
});
