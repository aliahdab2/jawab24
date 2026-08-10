/**
 * Deterministic image composition for generated post images («بوست اليوم»).
 *
 * Turns the raw generated photograph into a DESIGNED post card — the
 * industry composition (Predis/AdCreative class): brand scrim + typeset
 * Arabic headline + page-logo badge. All sharp/SVG, zero AI cost, zero
 * network I/O — the logo arrives as a pre-fetched Buffer (the caller owns
 * `fetchRoundedLogo` and can parallelize it with the image call). WE render
 * the Arabic text, so typography is always perfect — the image model never
 * writes a letter (its Arabic is broken by design of our prompt).
 *
 * Best-effort by contract for LAYER failures: a failed scrim/headline/badge
 * returns the best buffer produced so far — a missing design layer is
 * cosmetic. The BASE image is different: undecodable model output returns
 * null so the caller degrades to text-only instead of shipping (and paying
 * to store) corrupt bytes as the post image.
 *
 * Arabic SHAPING in the SVG path relies on the host's font stack via
 * fontconfig/harfbuzz. The production image installs `fontconfig` +
 * `font-noto-arabic` (backend/Dockerfile); as the honest fallback the code
 * probes fontconfig ONCE per process and, when no Arabic-capable family
 * exists, skips the headline text AND the accent bar (decoration pointing at
 * absent text) — shipping scrim-only rather than tofu.
 */
import sharp, { type OverlayOptions } from 'sharp';
import { execFileSync } from 'child_process';
import { captureError } from '../utils/sentryHelpers';

/** Badge geometry on a 1024×1024 canvas. */
const BADGE_SIZE = 112;   // white circular plate
const LOGO_SIZE = 96;     // logo inside the plate
const MARGIN = 28;        // distance from the corner

const LOGO_FETCH_TIMEOUT_MS = 5_000;
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // profile pictures are tiny; refuse anything odd

/** Jawab24 brand scrim/accent for the pilot. Post-pilot lever: derive the
 *  accent from the page logo's dominant color (sharp stats) per merchant. */
const SCRIM_COLOR = '#0a3d34';
const ACCENT_COLOR = '#2dd4bf';
/**
 * Arabic families first, then a LATIN family, then the generic alias. Headlines
 * are mixed-script in practice («دورة ICDL تبدأ اليوم»), and pango resolves
 * per-glyph down this list — so an Arabic-only stack draws Latin as tofu.
 * 'Noto Sans' must stay paired with the `font-noto` package in the Dockerfile:
 * the generic `sans-serif` tail is NOT a safety net, it resolves to nothing on
 * an alpine that ships no Latin font.
 */
const HEADLINE_FONT_STACK = "Cairo, Tajawal, 'Noto Sans Arabic', 'Geeza Pro', 'Noto Sans', DejaVu Sans, sans-serif";

/** Headline typesetting bounds — the compositor must never trust model text to fit. */
const HEADLINE_FONT_SIZE = 60;
const HEADLINE_SIDE_MARGIN = 96;
/** Conservative estimated advance per glyph at 60px weight-700 Arabic. */
const HEADLINE_CHAR_ADVANCE = 32;
/** Degenerate input (the prompt asks for 2–5 words): drop the layer instead of clipping. */
const HEADLINE_MAX_WORDS = 6;
const HEADLINE_MAX_CHARS = 40;

/** JPEG for the final card: photographic content, no transparency — ~10× smaller
 *  than PNG on Libyan mobile networks, and FB/IG accept JPEG for posts. */
const JPEG_OPTIONS = { quality: 88, mozjpeg: true } as const;

/** Exported for tests — the injection barrier for model-authored headline text. */
export function escapeXml(s: string): string {
    return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string));
}

/**
 * Does fontconfig know a font family for EVERY script a headline can contain?
 * Probed ONCE per process (first compose), via `fc-list :lang=<code>`.
 *
 * Both Arabic AND Latin are required. Checking only Arabic is what let the
 * 2026-08-10 tofu bug ship: the container had 72 Arabic families and 0 Latin,
 * so the probe said "fonts fine" and «دورة ICDL تبدأ اليوم» rendered the Latin
 * word as codepoint boxes on a card a merchant could have posted publicly.
 * A missing script for EITHER means the whole text layer is unsafe — a
 * scrim-only card is a clean degrade, a half-tofu headline is not.
 *
 * Semantics: fc-list running and reporting ZERO families for a script is the
 * only "no" — that is the broken-container state. fc-list being absent/failing
 * means we are on a host without fontconfig tooling (dev macOS renders both
 * fine through its system stack), so assume fonts are present and render.
 */
let headlineFontsPresent: boolean | null = null;
function hasHeadlineFonts(): boolean {
    if (headlineFontsPresent !== null) return headlineFontsPresent;
    try {
        const missing = (['ar', 'en'] as const).filter((lang) => {
            const out = execFileSync('fc-list', [`:lang=${lang}`], {
                encoding: 'utf8',
                timeout: 3_000,
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            return out.trim().length === 0;
        });
        headlineFontsPresent = missing.length === 0;
        if (!headlineFontsPresent) {
            // Once per process: the deliverable is visibly degraded (scrim-only
            // cards) until the image ships fontconfig + font-noto-arabic + font-noto.
            captureError(
                new Error(`fontconfig reports no font family for: ${missing.join(', ')}`),
                'Post card: missing script font — skipping headline/accent layers (scrim only)',
                {
                    level: 'warning',
                    tags: { service: 'post-suggestions' },
                    fingerprint: ['post-suggestions-missing-script-font'],
                },
            );
        }
    } catch {
        // fc-list unavailable (dev macOS) — not evidence of missing fonts.
        headlineFontsPresent = true;
    }
    return headlineFontsPresent;
}

/** Fetch + circle-mask the page avatar; null on any failure (badge skipped). */
export async function fetchRoundedLogo(logoUrl: string): Promise<Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(logoUrl, { signal: controller.signal, redirect: 'follow' });
        if (!res.ok) return null;
        const raw = Buffer.from(await res.arrayBuffer());
        if (raw.byteLength === 0 || raw.byteLength > MAX_LOGO_BYTES) return null;
        const circleMask = Buffer.from(
            `<svg width="${LOGO_SIZE}" height="${LOGO_SIZE}"><circle cx="${LOGO_SIZE / 2}" cy="${LOGO_SIZE / 2}" r="${LOGO_SIZE / 2}" fill="#fff"/></svg>`,
        );
        return await sharp(raw)
            .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover' })
            .composite([{ input: circleMask, blend: 'dest-in' }])
            .png()
            .toBuffer();
    } catch (err) {
        // A systematic break here (Graph /picture policy change, CDN rot)
        // unbrands every card fleet-wide — it must be distinguishable from
        // "page has no logo", so the reason is captured (fingerprinted, warning).
        captureError(err, 'Post card: logo fetch failed — badge skipped', {
            level: 'warning',
            tags: { service: 'post-suggestions' },
            fingerprint: ['post-suggestions-logo-fetch'],
        });
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The scrim + headline SVG layer markup. Exported as the unit-testable seam
 * (string assertions — raster output is fontconfig-dependent and untestable
 * across machines).
 *
 * Returns null when the headline is degenerate (> ~6 words / > ~40 chars —
 * the model was asked for 2–5 words): the best-effort contract prefers no
 * headline over a clipped one, and scrim/accent without text is pure noise.
 * With `renderText: false` (no Arabic font in fontconfig) the scrim still
 * renders but the text AND the accent bar are dropped — decoration must not
 * point at absent text.
 */
export function buildHeadlineLayerSvg(
    width: number,
    height: number,
    headline: string,
    opts: { renderText: boolean },
): string | null {
    const words = headline.split(/\s+/).filter(Boolean);
    if (words.length > HEADLINE_MAX_WORDS || headline.length > HEADLINE_MAX_CHARS) return null;

    const scrimH = Math.round(height * 0.3);
    // Deterministic width clamp: when the estimated advance exceeds the text
    // box, let SVG compress glyph spacing to fit instead of clipping the
    // phrase-end (RTL overflows on the LEFT) at the canvas edge.
    const boxWidth = width - 2 * HEADLINE_SIDE_MARGIN;
    const estimatedWidth = headline.length * HEADLINE_CHAR_ADVANCE;
    const fitAttrs = estimatedWidth > boxWidth ? ` textLength="${boxWidth}" lengthAdjust="spacingAndGlyphs"` : '';

    const textLayers = opts.renderText
        ? `
  <rect x="${width - HEADLINE_SIDE_MARGIN - 440}" y="${height - 190}" width="440" height="6" rx="3" fill="${ACCENT_COLOR}"/>
  <text x="${width - HEADLINE_SIDE_MARGIN}" y="${height - 104}" direction="rtl" text-anchor="start"
        font-family="${HEADLINE_FONT_STACK}"
        font-size="${HEADLINE_FONT_SIZE}" font-weight="700" fill="#ffffff"${fitAttrs}>${escapeXml(headline)}</text>`
        : '';

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="55%" stop-color="${SCRIM_COLOR}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${SCRIM_COLOR}" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${height - scrimH}" width="${width}" height="${scrimH}" fill="url(#scrim)"/>${textLayers}
</svg>`;
}

/**
 * A branded background drawn in CODE — no image model, no cost, no variance.
 *
 * This is the answer to the sameness problem that three prompt-level attempts
 * could not solve (2026-08-10): a service business whose world is one room
 * cannot be talked into a different photographic SCENE, but it can be given a
 * different KIND of image. A typographic poster is exactly as on-brand and
 * needs no photograph at all.
 *
 * `variant` rotates the composition so two posters never look identical either.
 * Deterministic: the same variant always renders the same background.
 */
export function buildPosterBaseSvg(
    width: number,
    height: number,
    variant: number,
    headline?: string | null,
): string {
    // Three arrangements of the same brand palette. Kept as geometry rather
    // than imagery so nothing here can ever render text, a face, or a hand.
    const v = ((variant % 3) + 3) % 3;
    const shapes = [
        `<circle cx="${width * 0.82}" cy="${height * 0.18}" r="${width * 0.30}" fill="${ACCENT_COLOR}" fill-opacity="0.10"/>
         <circle cx="${width * 0.20}" cy="${height * 0.30}" r="${width * 0.18}" fill="#ffffff" fill-opacity="0.05"/>`,
        `<rect x="${-width * 0.10}" y="${height * 0.08}" width="${width * 0.75}" height="${height * 0.22}" rx="${height * 0.11}" fill="${ACCENT_COLOR}" fill-opacity="0.09" transform="rotate(-12 ${width / 2} ${height / 2})"/>
         <circle cx="${width * 0.88}" cy="${height * 0.42}" r="${width * 0.16}" fill="#ffffff" fill-opacity="0.05"/>`,
        `<path d="M0,${height * 0.42} Q${width * 0.5},${height * 0.16} ${width},${height * 0.40} L${width},0 L0,0 Z" fill="${ACCENT_COLOR}" fill-opacity="0.10"/>
         <circle cx="${width * 0.28}" cy="${height * 0.16}" r="${width * 0.12}" fill="#ffffff" fill-opacity="0.06"/>`,
    ][v];

    // On a poster the TYPE is the subject, so it is set large and centred —
    // not tucked into the bottom scrim, which is the right place only when a
    // photograph occupies the frame. Wrapped across up to three lines because
    // a centred headline that overflows looks broken in a way a cropped
    // bottom line does not.
    const words = (headline ?? '').trim().split(/\s+/).filter(Boolean);
    const wantsText = words.length > 0 && words.length <= HEADLINE_MAX_WORDS
        && (headline as string).length <= HEADLINE_MAX_CHARS && hasHeadlineFonts();

    let textLayer = '';
    if (wantsText) {
        const lines = wrapWords(words, 3);
        const size = lines.length >= 3 ? 84 : lines.length === 2 ? 96 : 108;
        const lineHeight = size * 1.42;
        // Optical, not arithmetic, centring: the accent rule sits above the type
        // and carries visual weight, so a group centred at exactly height/2
        // reads high. Nudging down by 4% balances it.
        const blockTop = height * 0.54 - ((lines.length - 1) * lineHeight) / 2;
        const rows = lines.map((line, i) =>
            `<text x="${width / 2}" y="${blockTop + i * lineHeight}" text-anchor="middle" direction="rtl"
        font-family="${HEADLINE_FONT_STACK}" font-size="${size}" font-weight="700" fill="#ffffff"
        dominant-baseline="middle">${escapeXml(line)}</text>`).join('\n  ');
        const ruleY = blockTop - lineHeight * 0.78;
        textLayer = `
  <rect x="${width / 2 - 90}" y="${ruleY}" width="180" height="6" rx="3" fill="${ACCENT_COLOR}"/>
  ${rows}`;
    }

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="poster" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0e5347"/>
      <stop offset="100%" stop-color="${SCRIM_COLOR}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#poster)"/>
  ${shapes}${textLayer}
</svg>`;
}

/**
 * Balance words over the FEWEST lines that keeps each line short (~3 words).
 *
 * Not "always fill maxLines": five words over three lines strands a single
 * word on its own row, which reads as a mistake. Five words want two lines.
 */
export function wrapWords(words: string[], maxLines = 3, perLineTarget = 3): string[] {
    const lineCount = Math.min(maxLines, Math.max(1, Math.ceil(words.length / perLineTarget)));
    const perLine = Math.ceil(words.length / lineCount);
    const lines: string[] = [];
    for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine).join(' '));
    return lines;
}

/**
 * Rasterise the poster so it can feed composePostCard as a base. The headline
 * is drawn HERE, not by the card's bottom-scrim layer — so the caller passes
 * `headline: null` onward and composePostCard contributes only the logo badge.
 */
export async function renderPosterBase(
    width: number,
    height: number,
    variant: number,
    headline?: string | null,
): Promise<Buffer> {
    return sharp(Buffer.from(buildPosterBaseSvg(width, height, variant, headline))).png().toBuffer();
}

/**
 * Compose the designed post card: bottom brand scrim + Arabic headline
 * (bottom-end) + logo badge (top-end, clear of the text). Either layer is
 * skipped independently when its input is missing.
 *
 * `logo` is a pre-fetched, pre-rounded buffer (`fetchRoundedLogo`) — the
 * caller fetches it in parallel with the image call; this function performs
 * no network I/O.
 *
 * Returns null when the BASE buffer is not a decodable image (truncated /
 * invalid model output) — the caller must degrade to text-only, never upload
 * the corrupt input. Layer failures still return the best buffer so far.
 */
export async function composePostCard(
    base: Buffer,
    opts: { headline?: string | null; logo?: Buffer | null },
): Promise<Buffer | null> {
    let width: number;
    let height: number;
    try {
        const meta = await sharp(base).metadata();
        width = meta.width ?? 1024;
        height = meta.height ?? 1024;
    } catch (err) {
        captureError(err, 'Post card: base image undecodable — degrading to text-only', {
            level: 'warning', tags: { service: 'post-suggestions' },
        });
        return null;
    }

    try {
        const layers: OverlayOptions[] = [];

        const headline = opts.headline?.trim();
        if (headline) {
            const svg = buildHeadlineLayerSvg(width, height, headline, { renderText: hasHeadlineFonts() });
            if (svg) layers.push({ input: Buffer.from(svg), left: 0, top: 0 });
        }

        if (opts.logo) {
            const plate = Buffer.from(
                `<svg width="${BADGE_SIZE}" height="${BADGE_SIZE}"><circle cx="${BADGE_SIZE / 2}" cy="${BADGE_SIZE / 2}" r="${BADGE_SIZE / 2}" fill="#ffffff" fill-opacity="0.92"/></svg>`,
            );
            // Top-end corner — clear of the bottom headline scrim.
            const plateLeft = width - BADGE_SIZE - MARGIN;
            const logoInset = (BADGE_SIZE - LOGO_SIZE) / 2;
            layers.push({ input: plate, left: plateLeft, top: MARGIN });
            layers.push({ input: opts.logo, left: plateLeft + logoInset, top: MARGIN + logoInset });
        }

        if (layers.length === 0) return await sharp(base).jpeg(JPEG_OPTIONS).toBuffer();
        return await sharp(base).composite(layers).jpeg(JPEG_OPTIONS).toBuffer();
    } catch (err) {
        captureError(err, 'Post card composition failed — shipping plain image', {
            level: 'warning', tags: { service: 'post-suggestions' },
        });
        // Layer failure: ship the (decode-verified) base, re-encoded to match
        // the .jpg key/content-type the caller uploads under. If even the
        // re-encode fails, the raw base still beats no image — browsers and
        // Meta sniff content, so a PNG payload under a .jpg name renders.
        try {
            return await sharp(base).jpeg(JPEG_OPTIONS).toBuffer();
        } catch {
            return base;
        }
    }
}
