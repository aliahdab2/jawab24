/**
 * Deterministic image composition for generated post images («بوست اليوم»).
 *
 * Turns the raw generated photograph into a DESIGNED post card — the
 * industry composition (Predis/AdCreative class): brand scrim + typeset
 * Arabic headline + page-logo badge. All sharp/SVG, zero AI cost. WE render
 * the Arabic text, so typography is always perfect — the image model never
 * writes a letter (its Arabic is broken by design of our prompt).
 *
 * STRICTLY best-effort by contract: any failure (logo unreachable, sharp
 * error, font issue) returns the best buffer produced so far — a missing
 * design layer is cosmetic, a failed post image is a broken feature.
 *
 * ⚠️ Arabic SHAPING in the SVG path relies on the host's font stack +
 * harfbuzz (verified correct on macOS dev). Before production rollout,
 * verify inside the Linux container that an Arabic font (Cairo/Noto Sans
 * Arabic) is present in fontconfig — tofu/disconnected glyphs there mean
 * the image ships headline-less until the font lands in the Docker image
 * (the satori path in frontend/scripts/lib/socialCard.ts is the proven
 * fallback with bundled fonts).
 */
import sharp, { type OverlayOptions } from 'sharp';
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

function escapeXml(s: string): string {
    return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string));
}

/** Fetch + circle-mask the page avatar; null on any failure (badge skipped). */
async function fetchRoundedLogo(logoUrl: string): Promise<Buffer | null> {
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
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Compose the designed post card: bottom brand scrim + Arabic headline
 * (bottom-end) + logo badge (top-end, clear of the text). Either layer is
 * skipped independently when its input is missing/unfetchable.
 */
export async function composePostCard(
    base: Buffer,
    opts: { headline?: string | null; logoUrl?: string | null },
): Promise<Buffer> {
    try {
        const meta = await sharp(base).metadata();
        const width = meta.width ?? 1024;
        const height = meta.height ?? 1024;

        const layers: OverlayOptions[] = [];

        const headline = opts.headline?.trim();
        if (headline) {
            const scrimH = Math.round(height * 0.3);
            const textLayer = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="55%" stop-color="${SCRIM_COLOR}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${SCRIM_COLOR}" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${height - scrimH}" width="${width}" height="${scrimH}" fill="url(#scrim)"/>
  <rect x="${width - 96 - 440}" y="${height - 190}" width="440" height="6" rx="3" fill="${ACCENT_COLOR}"/>
  <text x="${width - 96}" y="${height - 104}" direction="rtl" text-anchor="start"
        font-family="${ARABIC_FONT_STACK}"
        font-size="60" font-weight="700" fill="#ffffff">${escapeXml(headline)}</text>
</svg>`;
            layers.push({ input: Buffer.from(textLayer), left: 0, top: 0 });
        }

        if (opts.logoUrl) {
            const roundedLogo = await fetchRoundedLogo(opts.logoUrl);
            if (roundedLogo) {
                const plate = Buffer.from(
                    `<svg width="${BADGE_SIZE}" height="${BADGE_SIZE}"><circle cx="${BADGE_SIZE / 2}" cy="${BADGE_SIZE / 2}" r="${BADGE_SIZE / 2}" fill="#ffffff" fill-opacity="0.92"/></svg>`,
                );
                // Top-end corner — clear of the bottom headline scrim.
                const plateLeft = width - BADGE_SIZE - MARGIN;
                const logoInset = (BADGE_SIZE - LOGO_SIZE) / 2;
                layers.push({ input: plate, left: plateLeft, top: MARGIN });
                layers.push({ input: roundedLogo, left: plateLeft + logoInset, top: MARGIN + logoInset });
            }
        }

        if (layers.length === 0) return base;
        return await sharp(base).composite(layers).png().toBuffer();
    } catch (err) {
        captureError(err, 'Post card composition failed — shipping plain image', {
            level: 'warning', tags: { service: 'post-suggestions' },
        });
        return base;
    }
}
