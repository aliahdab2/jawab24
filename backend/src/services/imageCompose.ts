/**
 * Deterministic image composition for generated post images («بوست اليوم»).
 *
 * Brands a generated image with the page's logo — a sharp composite, zero AI
 * cost (the satori/sharp direction the plan parked; this is its first, smallest
 * slice). STRICTLY best-effort by contract: any failure (logo unreachable, not
 * an image, sharp error) returns the ORIGINAL buffer — a missing badge is
 * cosmetic, a failed post image is a broken feature.
 */
import sharp from 'sharp';
import { captureError } from '../utils/sentryHelpers';

/** Badge geometry on a 1024×1024 canvas. */
const BADGE_SIZE = 112;   // white circular plate
const LOGO_SIZE = 96;     // logo inside the plate
const MARGIN = 28;        // distance from the corner

const LOGO_FETCH_TIMEOUT_MS = 5_000;
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // profile pictures are tiny; refuse anything odd

/**
 * Composite the page logo (bottom-right corner, white circular plate for
 * contrast on any scene) onto a generated post image. Returns the original
 * buffer untouched when the logo can't be fetched or processed.
 */
export async function overlayPageLogo(base: Buffer, logoUrl: string | null | undefined): Promise<Buffer> {
    if (!logoUrl) return base;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
        let logoBytes: Buffer;
        try {
            const res = await fetch(logoUrl, { signal: controller.signal, redirect: 'follow' });
            if (!res.ok) return base;
            const raw = Buffer.from(await res.arrayBuffer());
            if (raw.byteLength === 0 || raw.byteLength > MAX_LOGO_BYTES) return base;
            logoBytes = raw;
        } finally {
            clearTimeout(timer);
        }

        // Round the logo: cover-fit into a circle so rectangular profile
        // pictures don't ship as awkward squares.
        const circleMask = Buffer.from(
            `<svg width="${LOGO_SIZE}" height="${LOGO_SIZE}"><circle cx="${LOGO_SIZE / 2}" cy="${LOGO_SIZE / 2}" r="${LOGO_SIZE / 2}" fill="#fff"/></svg>`,
        );
        const roundedLogo = await sharp(logoBytes)
            .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover' })
            .composite([{ input: circleMask, blend: 'dest-in' }])
            .png()
            .toBuffer();

        const plate = Buffer.from(
            `<svg width="${BADGE_SIZE}" height="${BADGE_SIZE}"><circle cx="${BADGE_SIZE / 2}" cy="${BADGE_SIZE / 2}" r="${BADGE_SIZE / 2}" fill="#ffffff" fill-opacity="0.92"/></svg>`,
        );

        const meta = await sharp(base).metadata();
        const width = meta.width ?? 1024;
        const height = meta.height ?? 1024;
        const plateLeft = width - BADGE_SIZE - MARGIN;
        const plateTop = height - BADGE_SIZE - MARGIN;
        const logoInset = (BADGE_SIZE - LOGO_SIZE) / 2;

        return await sharp(base)
            .composite([
                { input: plate, left: plateLeft, top: plateTop },
                { input: roundedLogo, left: plateLeft + logoInset, top: plateTop + logoInset },
            ])
            .png()
            .toBuffer();
    } catch (err) {
        captureError(err, 'Post image logo overlay failed — shipping unbranded image', {
            level: 'warning', tags: { service: 'post-suggestions' },
        });
        return base;
    }
}
