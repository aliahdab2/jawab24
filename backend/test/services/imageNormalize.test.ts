import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { normalizeImage } from '../../src/services/imageNormalize';

/** A solid-colour JPEG carrying EXIF, including the GPS tags a phone camera writes.
 *  `withMetadata` is what puts them there — normalizeImage must take them back out. */
async function jpegWithGps(width = 300, height = 200): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: '#3b7d6e' } })
        .withMetadata({
            exif: {
                IFD0: { Copyright: 'Jawab24 test' },
                GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
            },
        })
        .jpeg()
        .toBuffer();
}

function solid(format: 'png' | 'webp', width = 300, height = 200, alpha = false) {
    const img = sharp({
        create: { width, height, channels: 4, background: { r: 20, g: 120, b: 90, alpha: alpha ? 0.4 : 1 } },
    });
    return format === 'png' ? img.png().toBuffer() : img.webp().toBuffer();
}

describe('normalizeImage', () => {
    it('strips EXIF and GPS from a JPEG', async () => {
        const before = await sharp(await jpegWithGps()).metadata();
        expect(before.exif).toBeDefined();

        const after = await sharp(await normalizeImage(await jpegWithGps(), 'image/jpeg')).metadata();
        expect(after.exif).toBeUndefined();
    });

    it('downscales an oversized image to the 1920px long edge', async () => {
        const huge = await sharp({ create: { width: 4000, height: 2000, channels: 3, background: '#fff' } })
            .jpeg().toBuffer();

        const meta = await sharp(await normalizeImage(huge, 'image/jpeg')).metadata();
        expect(meta.width).toBe(1920);
        expect(meta.height).toBe(960); // aspect ratio preserved
    });

    it('does NOT enlarge an image that is already small', async () => {
        const meta = await sharp(await normalizeImage(await jpegWithGps(300, 200), 'image/jpeg')).metadata();
        expect(meta.width).toBe(300);
        expect(meta.height).toBe(200);
    });

    it('keeps each format as itself (the key extension must stay truthful)', async () => {
        const jpeg = await sharp(await normalizeImage(await jpegWithGps(), 'image/jpeg')).metadata();
        const png = await sharp(await normalizeImage(await solid('png'), 'image/png')).metadata();
        const webp = await sharp(await normalizeImage(await solid('webp'), 'image/webp')).metadata();

        expect(jpeg.format).toBe('jpeg');
        expect(png.format).toBe('png');
        expect(webp.format).toBe('webp');
    });

    it('preserves transparency on PNG', async () => {
        const out = await normalizeImage(await solid('png', 300, 200, true), 'image/png');
        const meta = await sharp(out).metadata();
        expect(meta.hasAlpha).toBe(true);

        // The alpha must still be partial, not flattened onto an opaque background.
        const [, , , a] = await sharp(out).ensureAlpha().raw().toBuffer();
        expect(a).toBeLessThan(255);
    });

    it('keeps every frame of an animated WEBP', async () => {
        const frame = (bg: string) =>
            sharp({ create: { width: 60, height: 60, channels: 4, background: bg } }).png().toBuffer();
        const animated = await sharp(
            [await frame('#f00'), await frame('#0f0'), await frame('#00f')],
            { join: { animated: true } },
        ).webp({ delay: [100, 100, 100], loop: 0 }).toBuffer();
        expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(3);

        const out = await normalizeImage(animated, 'image/webp');
        const meta = await sharp(out, { animated: true }).metadata();
        expect(meta.pages).toBe(3);
        expect(meta.format).toBe('webp');
    });

    it('applies EXIF orientation before dropping it, so photos do not end up sideways', async () => {
        // Orientation 6 = "rotate 90° clockwise on display". A 400x200 image tagged
        // that way must come out 200x400 once the rotation is baked in.
        const rotated = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#123456' } })
            .withMetadata({ orientation: 6 })
            .jpeg()
            .toBuffer();

        const meta = await sharp(await normalizeImage(rotated, 'image/jpeg')).metadata();
        expect(meta.width).toBe(200);
        expect(meta.height).toBe(400);
    });

    it('rejects an unsupported mime rather than storing it unprocessed', async () => {
        await expect(normalizeImage(await jpegWithGps(), 'image/gif')).rejects.toThrow(/unsupported mime/);
    });

    it('rejects a buffer that is not a decodable image', async () => {
        await expect(normalizeImage(Buffer.from('not an image'), 'image/jpeg')).rejects.toThrow();
    });
});
