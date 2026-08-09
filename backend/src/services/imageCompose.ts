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
const ARABIC_FONT_STACK = "Cairo, Tajawal, 'Noto Sans Arabic', 'Geeza Pro', sans-serif";

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
 * Does fontconfig know an Arabic-capable font family? Probed ONCE per process
 * (first compose), via `fc-list :lang=ar`.
 *
 * Semantics: fc-list running and reporting ZERO Arabic families is the only
 * "no" — that is the broken-container state (Alpine without the font package)
 * where pango renders tofu. fc-list being absent/failing means we are on a
 * host without fontconfig tooling (dev macOS renders Arabic fine through its
 * system stack), so assume fonts are present and render.
 */
let arabicFontPresent: boolean | null = null;
function hasArabicFont(): boolean {
    if (arabicFontPresent !== null) return arabicFontPresent;
    try {
        const out = execFileSync('fc-list', [':lang=ar'], {
            encoding: 'utf8',
            timeout: 3_000,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        arabicFontPresent = out.trim().length > 0;
        if (!arabicFontPresent) {
            // Once per process: the deliverable is visibly degraded (scrim-only
            // cards) until the image ships fontconfig + font-noto-arabic.
            captureError(
                new Error('fontconfig reports no Arabic-capable font family'),
                'Post card: no Arabic font — skipping headline/accent layers (scrim only)',
                {
                    level: 'warning',
                    tags: { service: 'post-suggestions' },
                    fingerprint: ['post-suggestions-no-arabic-font'],
                },
            );
        }
    } catch {
        // fc-list unavailable (dev macOS) — not evidence of missing fonts.
        arabicFontPresent = true;
    }
    return arabicFontPresent;
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
        font-family="${ARABIC_FONT_STACK}"
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
            const svg = buildHeadlineLayerSvg(width, height, headline, { renderText: hasArabicFont() });
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
