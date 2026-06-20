import { describe, it, expect } from 'vitest';
import { isBusinessInfoProvided, KB_FILLED_MIN_CHARS } from '../index';

const LONG = 'x'.repeat(KB_FILLED_MIN_CHARS); // exactly at the threshold

describe('isBusinessInfoProvided', () => {
    it('is false when there is no knowledge base', () => {
        expect(isBusinessInfoProvided(null, null)).toBe(false);
        expect(isBusinessInfoProvided(undefined, undefined)).toBe(false);
        expect(isBusinessInfoProvided('', null)).toBe(false);
    });

    it('is false below the character threshold', () => {
        expect(isBusinessInfoProvided('x'.repeat(KB_FILLED_MIN_CHARS - 1), null)).toBe(false);
    });

    it('is false when content is identical to the Facebook auto-sync snapshot', () => {
        // First sync writes the SAME generated text into both fields → not "provided".
        expect(isBusinessInfoProvided(LONG, LONG)).toBe(false);
    });

    it('ignores leading/trailing whitespace when comparing against the snapshot', () => {
        expect(isBusinessInfoProvided(`  ${LONG}\n`, LONG)).toBe(false);
    });

    it('is true when long enough and authored from scratch (no suggestion)', () => {
        expect(isBusinessInfoProvided(LONG, null)).toBe(true);
        expect(isBusinessInfoProvided(LONG, '')).toBe(true);
    });

    it('is true when the merchant enriched the text beyond the snapshot', () => {
        expect(isBusinessInfoProvided(`${LONG} plus real merchant details`, LONG)).toBe(true);
    });

    it('still requires the threshold even when content diverges', () => {
        // Diverged from the snapshot but too short to be useful.
        expect(isBusinessInfoProvided('short but different', LONG)).toBe(false);
    });
});
