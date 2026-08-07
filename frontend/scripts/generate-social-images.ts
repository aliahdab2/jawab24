/**
 * Generates the brand social images from code, so they can never drift from the
 * channels we actually support.
 *
 * Why this exists: the shipped `og-social.png` was hand-made art reading "Smart AI
 * Auto-Replies for Facebook & Instagram" with only two channel glyphs. It stayed that
 * way for months after WhatsApp launched, because nothing in the repo tied the picture
 * to the product. It was also a JPEG named `.png` at 1024x1024 while `_app.tsx` declared
 * `og:image:width=1200` / `height=630` — so scrapers cropped it. Both classes of bug are
 * structurally impossible now: the canvas size is the spec, and the copy and glyphs come
 * from CHANNEL_ORDER.
 *
 * Run: npm run social:generate  (from frontend/)
 * Commit the emitted files — they are served as static assets, so nothing is rendered
 * at request time and no crawler depends on a font CDN being reachable.
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

/**
 * Output specs. Open Graph wants 1200x630; Play's feature graphic is exactly 1024x500.
 *
 * The Play graphics sit in the Gradle Play Publisher listing layout
 * (`app/src/main/play/listings/<locale>/graphics/feature-graphic/`). That is GPP's
 * documented convention, and it is inert for the current release path — the release
 * script runs `publishReleaseBundle`, which publishes the bundle only and never touches
 * listings. Both locales get the same card because the card is bilingual; `ar` previously
 * had no feature graphic at all and silently fell back to the English one.
 */
const TARGETS = [
    { out: 'public/brand/og-social.png', width: 1200, height: 630 },
    { out: 'android/app/src/main/play/listings/en-US/graphics/feature-graphic/main.png', width: 1024, height: 500 },
    { out: 'android/app/src/main/play/listings/ar/graphics/feature-graphic/main.png', width: 1024, height: 500 },
] as const;

const TAGLINE_EN = BRAND_ASSETS.socialCardTagline.en;
const TAGLINE_AR = BRAND_ASSETS.socialCardTagline.ar;

/**
 * Satori only parses TTF/OTF/WOFF, and `public/fonts/` holds woff2 only — so the fonts
 * come from Google Fonts. The legacy User-Agent matters: with a modern one the CSS API
 * hands back woff2, which satori rejects with "Unsupported OpenType signature wOF2".
 *
 * This is a network dependency at GENERATION time only. The emitted PNGs are committed
 * and served statically, so no crawler and no request path ever touches a font CDN.
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
 * Arabic string renders left-to-right. Per-word glyph shaping IS correct, so reversing
 * the word sequence and laying it out as a normal row produces the right result.
 *
 * That trick is only valid for a pure-Arabic, single-line string — a Latin word, a digit,
 * or a wrap would each be misplaced by the reversal. The guard below makes that a loud
 * failure at generation time instead of a subtly scrambled shipped image.
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

/** A channel glyph rendered as a colored disc, matching the app's PlatformIcon. */
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

function card(width: number, height: number) {
    const unit = height / 630; // scale every dimension off the OG canvas
    return {
        type: 'div',
        props: {
            style: {
                width,
                height,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 34 * unit,
                background: 'linear-gradient(135deg, #0f2f2c 0%, #123f3a 45%, #0b7c72 100%)',
                fontFamily: 'Outfit',
            },
            children: [
                // Wordmark row: app icon + "Jawab24"
                {
                    type: 'div',
                    props: {
                        style: { display: 'flex', alignItems: 'center', gap: 26 * unit },
                        children: [
                            {
                                type: 'div',
                                props: {
                                    style: {
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: 108 * unit,
                                        height: 108 * unit,
                                        borderRadius: 30 * unit,
                                        background: 'linear-gradient(140deg, #14b8a6 0%, #f59e0b 55%, #fb923c 100%)',
                                    },
                                    children: {
                                        type: 'svg',
                                        props: {
                                            width: 60 * unit,
                                            height: 60 * unit,
                                            viewBox: '0 0 24 24',
                                            fill: '#ffffff',
                                            children: {
                                                type: 'path',
                                                props: {
                                                    d: 'M12 2C6.477 2 2 5.94 2 10.8c0 2.77 1.46 5.24 3.74 6.86-.16 1.36-.7 2.62-1.5 3.62-.2.25.02.62.33.55 2.06-.46 3.6-1.3 4.55-1.95.9.2 1.86.32 2.88.32 5.523 0 10-3.94 10-8.8S17.523 2 12 2Z',
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                            {
                                type: 'div',
                                props: {
                                    style: { display: 'flex', color: '#ffffff', fontSize: 92 * unit, fontWeight: 700, letterSpacing: -2 * unit },
                                    children: 'Jawab24',
                                },
                            },
                        ],
                    },
                },
                // Bilingual tagline — English as a normal run, Arabic via rtlLine().
                {
                    type: 'div',
                    props: {
                        style: {
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 14 * unit,
                            color: 'rgba(255,255,255,0.94)',
                            fontSize: 30 * unit,
                            fontWeight: 700,
                        },
                        children: [
                            { type: 'div', props: { style: { display: 'flex' }, children: TAGLINE_EN } },
                            rtlLine(TAGLINE_AR, 30 * unit),
                        ],
                    },
                },
                // Channel lineup — driven by CHANNEL_ORDER, so a new channel shows up here
                {
                    type: 'div',
                    props: {
                        style: { display: 'flex', alignItems: 'center', gap: 22 * unit, marginTop: 10 * unit },
                        children: CHANNEL_ORDER.map((c) => channelBadge(c, 60 * unit)),
                    },
                },
            ],
        },
    };
}

async function main() {
    const fonts = await loadFonts();

    for (const target of TARGETS) {
        const svg = await satori(card(target.width, target.height) as never, {
            width: target.width,
            height: target.height,
            fonts,
        });
        const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

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
