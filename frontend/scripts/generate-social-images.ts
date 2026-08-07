/**
 * Generates the brand social images so the channel lineup can never drift from the
 * channels we actually support.
 *
 * Why this exists: the shipped `og-social.png` was hand-made art reading "Smart AI
 * Auto-Replies for Facebook & Instagram" with only two channel glyphs. It stayed that way
 * for months after WhatsApp launched, because nothing in the repo tied the picture to the
 * product. It was also a JPEG named `.png` at 1024x1024 while `_app.tsx` declared
 * `og:image:width=1200` / `height=630`, so scrapers cropped it.
 *
 * Design split, deliberately: the ARTWORK is a designed asset and stays untouched —
 * `assets/social-base.png` is the original brand card with its circuit-board background,
 * dimensional app icon and wordmark, with only the old tagline painted out. Everything
 * that depends on which channels we support (the bilingual tagline, the channel glyph row)
 * is drawn here from CHANNEL_ORDER. Redesigning the artwork is a design job; keeping it
 * truthful is a code job, and only the second half belongs in this script.
 *
 * Run: npm run social:generate  (from frontend/)
 * Commit the emitted files — they are served as static assets, so nothing is rendered at
 * request time and no crawler depends on a font CDN being reachable.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { BRAND_ASSETS } from '../src/constants/brand';
import { CHANNEL_BRAND_HEX, CHANNEL_GLYPH_PATHS, CHANNEL_ORDER } from '../src/constants/brandGlyphs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const BASE_ART = path.join(HERE, 'assets/social-base.png');

/** Natural size of the base artwork. All layout below is expressed in these coordinates. */
const BASE_W = 1024;
const BASE_H = 500;

/**
 * Output specs. Open Graph wants 1200x630; Play's feature graphic is exactly 1024x500.
 *
 * The Play graphics sit in the Gradle Play Publisher listing layout
 * (`app/src/main/play/listings/<locale>/graphics/feature-graphic/`). That is GPP's
 * documented convention, and it is inert for the current release path — the release script
 * runs `publishReleaseBundle`, which publishes the bundle only and never touches listings.
 * Both locales get the same card because the card is bilingual; `ar` previously had no
 * feature graphic at all and silently fell back to the English one.
 */
const TARGETS = [
    { out: 'public/brand/og-social.png', width: 1200, height: 630 },
    { out: 'android/app/src/main/play/listings/en-US/graphics/feature-graphic/main.png', width: 1024, height: 500 },
    { out: 'android/app/src/main/play/listings/ar/graphics/feature-graphic/main.png', width: 1024, height: 500 },
] as const;

const TAGLINE_EN = BRAND_ASSETS.socialCardTagline.en;
const TAGLINE_AR = BRAND_ASSETS.socialCardTagline.ar;

/** Layout in base coordinates — measured against the original artwork's tagline block. */
const LAYOUT = {
    textLeft: 415,
    taglineTop: 256,
    // 21px, not the original art's ~26px: naming three channels makes the line ~20% longer
    // and it has to clear the right edge at x=1024 from a left edge of 415.
    fontSize: 21,
    lineGap: 7,
    glyphSize: 34,
    glyphGap: 13,
    glyphTopGap: 18,
};

/**
 * Satori only parses TTF/OTF/WOFF, and `public/fonts/` holds woff2 only — so the fonts come
 * from Google Fonts. The legacy User-Agent matters: with a modern one the CSS API hands back
 * woff2, which satori rejects with "Unsupported OpenType signature wOF2".
 *
 * This is a network dependency at GENERATION time only. The emitted PNGs are committed and
 * served statically, so no crawler and no request path ever touches a font CDN.
 */
async function loadFont(family: string, weight: 700): Promise<Buffer> {
    const cssRes = await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`, {
        headers: { 'User-Agent': 'Mozilla/4.0' },
    });
    if (!cssRes.ok) throw new Error(`Google Fonts CSS for ${family}: HTTP ${cssRes.status}`);
    const css = await cssRes.text();
    const match = css.match(/src:\s*url\((https:\/\/[^)]+\.ttf)\)/);
    if (!match) throw new Error(`No TTF URL found for ${family} — did the CSS API change format?`);
    const fontRes = await fetch(match[1]);
    if (!fontRes.ok) throw new Error(`Font download for ${family}: HTTP ${fontRes.status}`);
    return Buffer.from(await fontRes.arrayBuffer());
}

async function loadFonts() {
    const [outfit, cairo] = await Promise.all([loadFont('Outfit', 700), loadFont('Cairo', 700)]);
    return [
        { name: 'Outfit', data: outfit, weight: 700 as const, style: 'normal' as const },
        { name: 'Cairo', data: cairo, weight: 700 as const, style: 'normal' as const },
    ];
}

/**
 * Lays out an Arabic line right-to-left.
 *
 * Satori (0.25) does NOT implement the Unicode bidirectional algorithm: it splits text
 * inside a flex container into one item per word and emits them in source order, so an
 * Arabic string renders left-to-right. Per-word glyph shaping IS correct, so reversing the
 * word sequence and laying it out as a normal row produces the right result.
 *
 * That trick is only valid for a pure-Arabic, single-line string — a Latin word, a digit, or
 * a wrap would each be misplaced by the reversal. The guard below makes that a loud failure
 * at generation time instead of a subtly scrambled shipped image.
 */
function rtlLine(text: string, fontSize: number) {
    if (/[A-Za-z0-9]/.test(text)) {
        throw new Error(
            `rtlLine() got "${text}", which contains Latin characters or digits. Word reversal ` +
            `cannot place those correctly. Split the line, or render that part separately.`,
        );
    }
    return {
        type: 'div',
        props: {
            style: { display: 'flex', flexDirection: 'row', gap: fontSize * 0.16, fontFamily: 'Cairo' },
            children: text
                .split(' ')
                .reverse()
                .map((word) => ({ type: 'div', props: { style: { display: 'flex' }, children: word } })),
        },
    };
}

/** A channel glyph on its brand-colored disc, matching the app's PlatformIcon. */
function channelBadge(channel: (typeof CHANNEL_ORDER)[number], size: number) {
    return {
        type: 'div',
        props: {
            style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: size,
                height: size,
                borderRadius: size,
                background: CHANNEL_BRAND_HEX[channel],
            },
            children: {
                type: 'svg',
                props: {
                    width: size * 0.62,
                    height: size * 0.62,
                    viewBox: '0 0 24 24',
                    fill: '#ffffff',
                    children: { type: 'path', props: { d: CHANNEL_GLYPH_PATHS[channel] } },
                },
            },
        },
    };
}

/** Transparent overlay: bilingual tagline + channel row, positioned over the base artwork. */
function overlay(width: number, height: number, scale: number) {
    const L = LAYOUT;
    const font = L.fontSize * scale;
    return {
        type: 'div',
        props: {
            style: {
                width,
                height,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                fontFamily: 'Outfit',
            },
            children: [
                {
                    type: 'div',
                    props: {
                        style: {
                            position: 'absolute',
                            left: L.textLeft * scale,
                            top: L.taglineTop * scale,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: L.lineGap * scale,
                            color: 'rgba(255,255,255,0.95)',
                            fontSize: font,
                            fontWeight: 700,
                        },
                        children: [
                            { type: 'div', props: { style: { display: 'flex' }, children: TAGLINE_EN } },
                            rtlLine(TAGLINE_AR, font),
                            {
                                type: 'div',
                                props: {
                                    style: {
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: L.glyphGap * scale,
                                        marginTop: L.glyphTopGap * scale,
                                    },
                                    children: CHANNEL_ORDER.map((c) => channelBadge(c, L.glyphSize * scale)),
                                },
                            },
                        ],
                    },
                },
            ],
        },
    };
}

/**
 * Fits the base artwork to a target aspect by EXTENDING it vertically rather than cropping,
 * so the icon and wordmark keep their position relative to the frame. The added strips are
 * copies of the edge rows, which works because the artwork's gradient runs horizontally.
 */
async function fitBase(targetW: number, targetH: number): Promise<{ buf: Buffer; scale: number; padTop: number }> {
    const neededH = Math.round((BASE_W * targetH) / targetW);
    const pad = Math.max(0, neededH - BASE_H);
    const padTop = Math.floor(pad / 2);
    const padBottom = pad - padTop;

    let canvas = sharp(BASE_ART);
    if (pad > 0) {
        const [topStrip, bottomStrip] = await Promise.all([
            sharp(BASE_ART).extract({ left: 0, top: 0, width: BASE_W, height: 1 }).resize(BASE_W, padTop, { fit: 'fill' }).png().toBuffer(),
            sharp(BASE_ART).extract({ left: 0, top: BASE_H - 1, width: BASE_W, height: 1 }).resize(BASE_W, padBottom, { fit: 'fill' }).png().toBuffer(),
        ]);
        const extended = await sharp({
            create: { width: BASE_W, height: neededH, channels: 3, background: '#000000' },
        })
            .composite([
                { input: topStrip, left: 0, top: 0 },
                { input: await sharp(BASE_ART).png().toBuffer(), left: 0, top: padTop },
                { input: bottomStrip, left: 0, top: padTop + BASE_H },
            ])
            .png()
            .toBuffer();
        canvas = sharp(extended);
    }

    const buf = await canvas.resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
    return { buf, scale: targetW / BASE_W, padTop };
}

async function main() {
    const fonts = await loadFonts();

    for (const target of TARGETS) {
        const { buf: base, scale, padTop } = await fitBase(target.width, target.height);

        // The overlay is drawn in target pixels, with base-space coordinates scaled up and
        // shifted by whatever vertical padding fitBase added.
        const svg = await satori(overlay(target.width, target.height, scale) as never, {
            width: target.width,
            height: target.height,
            fonts,
        });
        const textLayer = await sharp(Buffer.from(svg)).png().toBuffer();

        // Palette quantization, matching the optimization pass the original artwork had
        // (docs/poor-connection-optimizations.md): ~370KB truecolor down to well under
        // 100KB, with no visible banding on this artwork's gradients.
        const png = await sharp(base)
            .composite([{ input: textLayer, left: 0, top: Math.round(padTop * scale) }])
            .png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 })
            .toBuffer();

        // Assert the emitted pixels match the spec. The previous hand-made card was
        // 1024x1024 while the meta tags promised 1200x630, so scrapers cropped it.
        const meta = await sharp(png).metadata();
        if (meta.width !== target.width || meta.height !== target.height) {
            throw new Error(`${target.out}: expected ${target.width}x${target.height}, got ${meta.width}x${meta.height}`);
        }

        const out = path.join(FRONTEND, target.out);
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, png);
        console.log(`✓ ${target.out} — ${meta.width}x${meta.height}, ${(png.length / 1024).toFixed(0)} KB`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
