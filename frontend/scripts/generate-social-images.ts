/**
 * Generates the brand social images so the channel lineup can never drift from the channels
 * we actually support.
 *
 * Why this exists: the shipped `og-social.png` was hand-made art reading "Smart AI
 * Auto-Replies for Facebook & Instagram" with only two channel glyphs. It stayed that way
 * for months after WhatsApp launched, because nothing in the repo tied the picture to the
 * product. It was also a JPEG named `.png` at 1024x1024 while `_app.tsx` declared
 * `og:image:width=1200` / `height=630`, so scrapers cropped it.
 *
 * Design split, deliberately: the ARTWORK is a designed asset and stays untouched.
 * `assets/social-base-source.png` is the original brand card exactly as the designer made
 * it, tagline and all. This script strips that tagline in code (see INPAINT) and draws back
 * the parts that depend on which channels we support — the bilingual tagline and the channel
 * glyph row, both from CHANNEL_ORDER. Redesigning the artwork is a design job; keeping it
 * truthful is a code job, and only the second half lives here.
 *
 * Run: npm run social:generate  (from frontend/)
 * Commit the emitted files AND `assets/social-images.lock.json` — a test fails if the lock
 * and the sources disagree, which is what catches "edited the tagline, forgot to regenerate".
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { BRAND_ASSETS } from '../src/constants/brand';
import { CHANNEL_BRAND_HEX, CHANNEL_GLYPH_PATHS, CHANNEL_ORDER } from '../src/constants/brandGlyphs';
import {
    BASE_H,
    BASE_W,
    INPAINT,
    LAYOUT,
    LOCK_PATH,
    TARGETS,
    computeInputHash,
    hashBytes,
    rtlLine,
    verticalPadding,
} from './lib/socialCard';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const SOURCE_ART = path.join(HERE, 'assets/social-base-source.png');

const TAGLINE_EN = BRAND_ASSETS.socialCardTagline.en;
const TAGLINE_AR = BRAND_ASSETS.socialCardTagline.ar;

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
 * Paints out the tagline baked into the source artwork by interpolating each column between
 * the clean row above the text and the clean row below it. See INPAINT for why this works.
 */
async function inpaintSource(): Promise<Buffer> {
    const meta = await sharp(SOURCE_ART).metadata();
    if (meta.width !== BASE_W || meta.height !== BASE_H) {
        throw new Error(
            `social-base-source.png is ${meta.width}x${meta.height}, expected ${BASE_W}x${BASE_H}. ` +
            `LAYOUT and INPAINT are pixel coordinates against that size — re-measure them before ` +
            `swapping the artwork.`,
        );
    }

    const { data, info } = await sharp(SOURCE_ART).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const out = Buffer.from(data);
    const idx = (x: number, y: number) => (y * width + x) * channels;

    const above = INPAINT.Y_TOP - 2;
    const below = INPAINT.Y_BOT + 2;
    for (let x = INPAINT.X0; x < width; x++) {
        const a = idx(x, above);
        const b = idx(x, below);
        for (let y = INPAINT.Y_TOP; y <= INPAINT.Y_BOT; y++) {
            const t = (y - above) / (below - above);
            const o = idx(x, y);
            for (let c = 0; c < 3; c++) out[o + c] = Math.round(data[a + c] * (1 - t) + data[b + c] * t);
        }
    }

    return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
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

/**
 * Transparent overlay covering the whole target canvas.
 *
 * `padTop` is folded into the coordinates here and the caller composites at top:0. The
 * earlier version positioned the layer with a composite offset instead, which pushed the
 * bottom of the layer off the canvas — and sharp CLIPS that silently rather than throwing,
 * so content moved below the fold would have vanished with no error.
 */
function overlay(width: number, height: number, scale: number, padTop: number) {
    const font = LAYOUT.fontSize * scale;
    return {
        type: 'div',
        props: {
            style: { width, height, display: 'flex', position: 'relative', fontFamily: 'Outfit' },
            children: [
                {
                    type: 'div',
                    props: {
                        style: {
                            position: 'absolute',
                            left: LAYOUT.textLeft * scale,
                            top: (LAYOUT.taglineTop + padTop) * scale,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: LAYOUT.lineGap * scale,
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
                                        gap: LAYOUT.glyphGap * scale,
                                        marginTop: LAYOUT.glyphTopGap * scale,
                                    },
                                    children: CHANNEL_ORDER.map((c) => channelBadge(c, LAYOUT.glyphSize * scale)),
                                },
                            },
                        ],
                    },
                },
            ],
        },
    };
}

/** Extends the base to a target aspect with copies of its edge rows, then scales to size. */
async function fitBase(base: Buffer, targetW: number, targetH: number): Promise<Buffer> {
    const { neededH, total, top, bottom } = verticalPadding(targetW, targetH);

    let canvas = base;
    if (total > 0) {
        const [topStrip, bottomStrip] = await Promise.all([
            sharp(base).extract({ left: 0, top: 0, width: BASE_W, height: 1 }).resize(BASE_W, top, { fit: 'fill' }).png().toBuffer(),
            sharp(base).extract({ left: 0, top: BASE_H - 1, width: BASE_W, height: 1 }).resize(BASE_W, bottom, { fit: 'fill' }).png().toBuffer(),
        ]);
        canvas = await sharp({ create: { width: BASE_W, height: neededH, channels: 3, background: '#000000' } })
            .composite([
                { input: topStrip, left: 0, top: 0 },
                { input: base, left: 0, top },
                { input: bottomStrip, left: 0, top: top + BASE_H },
            ])
            .png()
            .toBuffer();
    }

    return sharp(canvas).resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
}

async function main() {
    const [fonts, base] = await Promise.all([loadFonts(), inpaintSource()]);
    const outputs: Record<string, string> = {};

    for (const target of TARGETS) {
        const fitted = await fitBase(base, target.width, target.height);
        const scale = target.width / BASE_W;
        const { top: padTop } = verticalPadding(target.width, target.height);

        const svg = await satori(overlay(target.width, target.height, scale, padTop) as never, {
            width: target.width,
            height: target.height,
            fonts,
        });
        const textLayer = await sharp(Buffer.from(svg)).png().toBuffer();

        // Palette quantization, matching the optimization pass the original artwork had
        // (docs/poor-connection-optimizations.md), with no visible banding on these gradients.
        const png = await sharp(fitted)
            .composite([{ input: textLayer, left: 0, top: 0 }])
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
        outputs[target.out] = hashBytes(png);
        console.log(`✓ ${target.out} — ${meta.width}x${meta.height}, ${(png.length / 1024).toFixed(0)} KB`);
    }

    const inputHash = computeInputHash({
        sourceArt: await fs.readFile(SOURCE_ART),
        taglineEn: TAGLINE_EN,
        taglineAr: TAGLINE_AR,
        channelOrder: CHANNEL_ORDER,
        channelHex: CHANNEL_BRAND_HEX,
        channelPaths: CHANNEL_GLYPH_PATHS,
    });
    await fs.writeFile(
        path.join(FRONTEND, LOCK_PATH),
        `${JSON.stringify({ inputHash, outputs, channels: CHANNEL_ORDER }, null, 2)}\n`,
    );
    console.log(`✓ ${LOCK_PATH} — channels: ${CHANNEL_ORDER.join(', ')}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
