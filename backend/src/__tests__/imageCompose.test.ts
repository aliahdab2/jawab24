/**
 * «بوست اليوم» compositor — the pure/deterministic parts.
 *
 * escapeXml is the injection barrier for MODEL-authored headline text placed
 * inside SVG; the headline layer is asserted as a STRING (the unit-testable
 * seam) — never as rasterized pixels, because glyph rasterization is
 * fontconfig-dependent and a raster snapshot would flake across machines
 * (dev macOS vs the Alpine container). The compose tests assert only
 * decodability + format of the output buffer, which sharp guarantees
 * machine-independently.
 *
 * The fontconfig probe is process-cached, so each test re-imports the module
 * (vi.resetModules) for a fresh cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';

const { mockExecFileSync, mockCaptureError } = vi.hoisted(() => ({
    mockExecFileSync: vi.fn(),
    mockCaptureError: vi.fn(),
}));

vi.mock('child_process', () => ({ execFileSync: mockExecFileSync }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: mockCaptureError }));

type ImageComposeModule = typeof import('../services/imageCompose');
let mod: ImageComposeModule;

/** A real, decodable base image — the compose contract needs actual pixels. */
const makeBasePng = () =>
    sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 40, g: 80, b: 60 } } })
        .png()
        .toBuffer();

beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: fontconfig reports an Arabic-capable family (the healthy container).
    mockExecFileSync.mockReturnValue('NotoSansArabic-Regular.ttf: Noto Sans Arabic:style=Regular');
    mod = await import('../services/imageCompose');
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('escapeXml — the SVG injection barrier for model-authored text', () => {
    it.each([
        ['<', '&lt;'],
        ['>', '&gt;'],
        ['&', '&amp;'],
        ['"', '&quot;'],
        ["'", '&apos;'],
    ])('escapes %s to %s', (raw, escaped) => {
        expect(mod.escapeXml(raw)).toBe(escaped);
    });

    it('passes Arabic text through untouched', () => {
        expect(mod.escapeXml('تشكيلة العطور وصلت!')).toBe('تشكيلة العطور وصلت!');
    });

    it('escapes every metacharacter in mixed content', () => {
        expect(mod.escapeXml('عرض <خاص> & "اليوم"')).toBe('عرض &lt;خاص&gt; &amp; &quot;اليوم&quot;');
    });
});

describe('buildHeadlineLayerSvg — typesetting bounds and honest degrades', () => {
    it('renders scrim + accent + RTL text with escaped content inside <text>', () => {
        const svg = mod.buildHeadlineLayerSvg(1024, 1024, 'عرض <خاص> & "اليوم"', { renderText: true });
        expect(svg).not.toBeNull();
        expect(svg).toContain('url(#scrim)');
        expect(svg).toContain('direction="rtl"');
        expect(svg).toContain('text-anchor="start"');
        expect(svg).toContain('عرض &lt;خاص&gt; &amp; &quot;اليوم&quot;');
        expect(svg).not.toContain('<خاص>'); // raw model text never lands in markup
    });

    it('the font stack names a real LATIN family, not just Arabic + the generic alias', () => {
        // Mixed-script headlines are routine (brand names, course codes, SKUs).
        // `sans-serif` is NOT a safety net — on an alpine with no Latin font it
        // resolves to nothing and pango draws codepoint boxes.
        const svg = mod.buildHeadlineLayerSvg(1024, 1024, 'دورة ICDL تبدأ اليوم', { renderText: true });
        expect(svg).not.toBeNull();
        expect(svg).toContain('ICDL');
        const stack = /font-family="([^"]+)"/.exec(svg as string)?.[1] ?? '';
        expect(stack).toContain("'Noto Sans Arabic'"); // Arabic script
        expect(stack).toMatch(/'Noto Sans'|DejaVu Sans/); // Latin script
    });

    it('a short in-spec headline gets NO width clamp', () => {
        const svg = mod.buildHeadlineLayerSvg(1024, 1024, 'تشكيلة العطور وصلت', { renderText: true });
        expect(svg).not.toBeNull();
        expect(svg).not.toContain('textLength');
    });

    it('a long-but-valid headline is clamped to the text box via textLength/spacingAndGlyphs', () => {
        // 38 chars × 32px estimated advance = 1216px > the 832px box (1024 − 2×96).
        const headline = 'اااااااااا بببببببببب تتتتتتتتتت ثثثثث';
        const svg = mod.buildHeadlineLayerSvg(1024, 1024, headline, { renderText: true });
        expect(svg).not.toBeNull();
        expect(svg).toContain('textLength="832"');
        expect(svg).toContain('lengthAdjust="spacingAndGlyphs"');
    });

    it('degenerate input (> 6 words) drops the whole layer — no headline beats a clipped one', () => {
        expect(mod.buildHeadlineLayerSvg(1024, 1024, 'ا ب ت ث ج ح خ', { renderText: true })).toBeNull();
    });

    it('degenerate input (> 40 chars) drops the whole layer', () => {
        expect(mod.buildHeadlineLayerSvg(1024, 1024, 'ا'.repeat(41), { renderText: true })).toBeNull();
    });

    it('renderText:false (no Arabic font) keeps the scrim but drops text AND the accent bar', () => {
        const svg = mod.buildHeadlineLayerSvg(1024, 1024, 'تشكيلة العطور وصلت', { renderText: false });
        expect(svg).not.toBeNull();
        expect(svg).toContain('url(#scrim)');
        expect(svg).not.toContain('<text');
        expect(svg).not.toContain('#2dd4bf'); // accent must not point at absent text
    });
});

describe('composePostCard — output format and base validation', () => {
    it('composes headline + logo layers into a decodable JPEG', async () => {
        const base = await makeBasePng();
        const logo = await sharp({ create: { width: 96, height: 96, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } } })
            .png().toBuffer();
        const result = await mod.composePostCard(base, { headline: 'تشكيلة العطور وصلت', logo });
        expect(result).not.toBeNull();
        const meta = await sharp(result as Buffer).metadata();
        expect(meta.format).toBe('jpeg');
        expect(meta.width).toBe(256);
    });

    it('no layers at all (no headline, logo fetch failed upstream ⇒ null) still returns a valid JPEG', async () => {
        const base = await makeBasePng();
        const result = await mod.composePostCard(base, { headline: null, logo: null });
        expect(result).not.toBeNull();
        const meta = await sharp(result as Buffer).metadata();
        expect(meta.format).toBe('jpeg');
    });

    it('an UNDECODABLE base returns null (degrade to text-only) — never the corrupt input bytes', async () => {
        const result = await mod.composePostCard(Buffer.from('definitely not an image'), { headline: 'عرض اليوم' });
        expect(result).toBeNull();
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringContaining('undecodable'),
            expect.objectContaining({ level: 'warning' }),
        );
    });

    it('probes fontconfig ONCE per process and skips text honestly when no font family exists', async () => {
        mockExecFileSync.mockReturnValue(''); // fc-list runs, reports zero families for every script
        const base = await makeBasePng();
        const first = await mod.composePostCard(base, { headline: 'عرض اليوم', logo: null });
        const second = await mod.composePostCard(base, { headline: 'عرض اليوم', logo: null });
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect((await sharp(first as Buffer).metadata()).format).toBe('jpeg');
        // One probe per script on the FIRST compose, then cached — the second
        // compose adds no calls.
        expect(mockExecFileSync).toHaveBeenCalledTimes(2);
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringContaining('missing script font'),
            expect.objectContaining({ fingerprint: ['post-suggestions-missing-script-font'] }),
        );
    });

    /**
     * REGRESSION (2026-08-10, caught on a real card): the container shipped
     * font-noto-arabic and nothing else — 72 Arabic families, 0 Latin. The
     * Arabic-only probe said "fonts fine", so «دورة ICDL تبدأ اليوم» rendered
     * the Arabic correctly and drew I/C/D/L as codepoint tofu boxes.
     */
    it('Arabic present but LATIN missing still drops the text layer (mixed-script headlines would tofu)', async () => {
        mockExecFileSync.mockImplementation((_cmd: string, args: string[]) =>
            args[0] === ':lang=ar' ? 'NotoSansArabic-Regular.ttf: Noto Sans Arabic:style=Regular' : '',
        );
        const base = await makeBasePng();
        const result = await mod.composePostCard(base, { headline: 'دورة ICDL تبدأ اليوم', logo: null });
        expect(result).not.toBeNull(); // scrim-only card, never a half-tofu headline
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringContaining('missing script font'),
            expect.objectContaining({ fingerprint: ['post-suggestions-missing-script-font'] }),
        );
        // The message must name the script that is actually missing.
        expect(mockCaptureError.mock.calls[0][0].message).toContain('en');
        expect(mockCaptureError.mock.calls[0][0].message).not.toContain('ar,');
    });

    it('fc-list being unavailable is NOT evidence of missing fonts — renders normally (dev macOS)', async () => {
        mockExecFileSync.mockImplementation(() => { throw new Error('spawn fc-list ENOENT'); });
        const base = await makeBasePng();
        const result = await mod.composePostCard(base, { headline: 'عرض اليوم', logo: null });
        expect(result).not.toBeNull();
        expect((await sharp(result as Buffer).metadata()).format).toBe('jpeg');
        expect(mockCaptureError).not.toHaveBeenCalled();
    });
});

/**
 * The poster background exists so a card can vary without an image model at
 * all — the one variety lever that cannot be ignored by a model.
 */
describe('buildPosterBaseSvg — a branded background drawn in code', () => {
    it('contains NO text element — the headline is typeset later, by the compositor', () => {
        const svg = mod.buildPosterBaseSvg(1024, 1024, 0);
        expect(svg).not.toContain('<text');
        expect(svg).toContain('<svg');
        expect(svg).toContain('1024');
    });

    it('is deterministic — the same variant renders byte-identical markup', () => {
        expect(mod.buildPosterBaseSvg(1024, 1024, 2)).toBe(mod.buildPosterBaseSvg(1024, 1024, 2));
    });

    it('actually differs between variants, and cycles', () => {
        const a = mod.buildPosterBaseSvg(1024, 1024, 0);
        const b = mod.buildPosterBaseSvg(1024, 1024, 1);
        const c = mod.buildPosterBaseSvg(1024, 1024, 2);
        expect(new Set([a, b, c]).size).toBe(3);
        expect(mod.buildPosterBaseSvg(1024, 1024, 3)).toBe(a);
    });

    it('survives a negative variant (a count can never make it throw)', () => {
        expect(() => mod.buildPosterBaseSvg(1024, 1024, -1)).not.toThrow();
    });

    it('typesets the headline itself, and escapes it', () => {
        const svg = mod.buildPosterBaseSvg(1024, 1024, 0, 'عرض <خاص> اليوم');
        expect(svg).toContain('<text');
        expect(svg).toContain('&lt;خاص&gt;');
        expect(svg).not.toContain('<خاص>');
    });

    it('refuses a headline past the word/char bounds rather than overflowing the frame', () => {
        expect(mod.buildPosterBaseSvg(1024, 1024, 0, 'ا ب ت ث ج ح خ')).not.toContain('<text');
        expect(mod.buildPosterBaseSvg(1024, 1024, 0, 'ا'.repeat(41))).not.toContain('<text');
    });
});

/**
 * The wrap decides whether a centred headline reads as designed or as broken.
 */
describe('wrapWords — fewest lines, never a stranded word', () => {
    it('five words go on TWO lines, not three with one word alone', () => {
        // The layout that shipped first split 5 words 2/2/1 and stranded «مرة».
        expect(mod.wrapWords(['المقاس', 'الصحيح', 'من', 'أول', 'مرة'])).toEqual([
            'المقاس الصحيح من', 'أول مرة',
        ]);
    });

    it('short headlines stay on one line', () => {
        expect(mod.wrapWords(['مقعدك', 'بانتظارك'])).toEqual(['مقعدك بانتظارك']);
        expect(mod.wrapWords(['ثلاث', 'كلمات', 'فقط'])).toEqual(['ثلاث كلمات فقط']);
    });

    it('never exceeds the line cap', () => {
        expect(mod.wrapWords(['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨'], 3).length).toBeLessThanOrEqual(3);
    });

    it('loses no words, whatever the split', () => {
        const words = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز'];
        expect(mod.wrapWords(words).join(' ').split(' ')).toEqual(words);
    });

    it('renders to a real decodable image at the requested size', async () => {
        const buf = await mod.renderPosterBase(512, 512, 1);
        const meta = await sharp(buf).metadata();
        expect(meta.width).toBe(512);
        expect(meta.height).toBe(512);
    });

    it('composes through the SAME card pipeline as a photograph', async () => {
        const base = await mod.renderPosterBase(512, 512, 0);
        const card = await mod.composePostCard(base, { headline: 'مقعدك بانتظارك' });
        expect(card).not.toBeNull();
        expect((await sharp(card as Buffer).metadata()).format).toBe('jpeg');
    });
});

describe('fetchRoundedLogo — never rejects, always null on failure', () => {
    it('network failure resolves null and captures the reason (fleet-wide breaks must be visible)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
        await expect(mod.fetchRoundedLogo('https://graph.facebook.com/123/picture')).resolves.toBeNull();
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringContaining('logo fetch failed'),
            expect.objectContaining({ fingerprint: ['post-suggestions-logo-fetch'] }),
        );
    });

    it('a non-OK response resolves null WITHOUT a capture (page simply has no picture)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        await expect(mod.fetchRoundedLogo('https://graph.facebook.com/123/picture')).resolves.toBeNull();
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('a valid image response resolves a rounded PNG buffer', async () => {
        const avatar = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 120, b: 90 } } })
            .png().toBuffer();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => avatar.buffer.slice(avatar.byteOffset, avatar.byteOffset + avatar.byteLength),
        }));
        const result = await mod.fetchRoundedLogo('https://cdn.example/pic.jpg');
        expect(result).not.toBeNull();
        const meta = await sharp(result as Buffer).metadata();
        expect(meta.format).toBe('png'); // keeps alpha for the circular mask
        expect(meta.width).toBe(96);
    });
});
