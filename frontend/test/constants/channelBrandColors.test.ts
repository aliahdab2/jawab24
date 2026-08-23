import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CHANNEL_BRAND_HEX, CHANNEL_ORDER } from '@/constants/brandGlyphs';

const require = createRequire(import.meta.url);
const tailwindConfig = require('../../tailwind.config.js') as {
    theme: { extend: { colors: { channel: Record<string, string> } } };
};

/**
 * The channel brand colors have to exist in two places that cannot import from each other:
 *
 *  - `tailwind.config.js`, because Tailwind's JIT scans SOURCE TEXT for class names. A class
 *    built from a variable (`bg-[${hex}]`) is never generated — that was tried, and it
 *    silently dropped the inbox channel marker's color. (That marker was a corner ribbon
 *    when this test was written; it is now the leading PlatformIcon chip, which reaches the
 *    same `channel.*` colors through PLATFORM_TINT_ON_ALERT's `bg-channel-*` utilities.)
 *  - `CHANNEL_BRAND_HEX`, because the social-image generator runs outside Tailwind entirely
 *    and needs raw hex to fill an SVG.
 *
 * A comment asking humans to keep them in sync is not a mechanism. This is.
 */
describe('channel brand colors', () => {
    const configColors = tailwindConfig.theme.extend.colors.channel;

    it.each([...CHANNEL_ORDER])('%s matches between tailwind.config.js and CHANNEL_BRAND_HEX', (channel) => {
        expect(configColors[channel]?.toUpperCase()).toBe(CHANNEL_BRAND_HEX[channel].toUpperCase());
    });

    it('defines exactly the supported channels — no extras, none missing', () => {
        expect(Object.keys(configColors).sort()).toEqual([...CHANNEL_ORDER].sort());
    });
});
