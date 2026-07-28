import sharp, { type Sharp } from 'sharp';

/**
 * Normalization for merchant-uploaded images, applied BEFORE they are stored.
 *
 * WHY THIS EXISTS: uploads used to be written to the bucket byte-for-byte, so EXIF
 * survived — including the GPS coordinates a phone camera records. The bucket is
 * public and the URL is handed to customers (the «عرض الصورة» button redirects to
 * it), so a merchant who photographs products at home was publishing their home
 * location to anyone who tapped. Re-encoding drops every metadata chunk.
 *
 * The size cap is a second benefit, not the point: with `is_reusable: false` Meta
 * re-fetches the image per recipient, so bounding dimensions bounds egress too.
 *
 * MUST run before the quota check and before `triggerImageBytes` is recorded —
 * those must describe the bytes actually stored, not the bytes uploaded.
 */

/** Longest-edge cap. Comfortably above what a Messenger card renders, so the
 *  downscale is invisible to customers while bounding stored + fetched bytes. */
const MAX_EDGE_PX = 1920;

/** Mirrors POST_REPLY_IMAGE_MIME_TYPES — the caller has already validated against it. */
type NormalizableMime = 'image/jpeg' | 'image/png' | 'image/webp';

function isNormalizable(mime: string): mime is NormalizableMime {
    return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
}

/** Re-encode in the SAME format the caller declared. Changing format would desync
 *  the stored mimeType and the key's extension (`extForMime`) from the content. */
function encode(pipeline: Sharp, mime: NormalizableMime): Sharp {
    switch (mime) {
        // mozjpeg: smaller files at equal quality, no alpha to worry about.
        case 'image/jpeg': return pipeline.jpeg({ quality: 85, mozjpeg: true });
        // No palette quantisation: it would wreck logos/graphics with soft gradients.
        case 'image/png': return pipeline.png({ compressionLevel: 9 });
        case 'image/webp': return pipeline.webp({ quality: 85 });
    }
}

/**
 * Strip all metadata and bound the dimensions of an image.
 *
 * Throws if the buffer cannot be decoded — the caller turns that into a 400. It
 * deliberately does NOT fall back to the original buffer: a silent fallback would
 * reintroduce the EXIF leak invisibly, which is the exact failure this prevents.
 */
export async function normalizeImage(buffer: Buffer, mimeType: string): Promise<Buffer> {
    if (!isNormalizable(mimeType)) {
        throw new Error(`normalizeImage: unsupported mime ${mimeType}`);
    }

    // `animated` keeps every frame of an animated WEBP; without it sharp silently
    // collapses the image to frame one. `failOn: 'none'` tolerates the slightly
    // malformed-but-renderable files real phones produce — rejecting those would
    // be a worse merchant experience than accepting them. Decompression bombs are
    // still blocked by sharp's default `limitInputPixels`.
    const readOpts = { animated: true, failOn: 'none' } as const;
    const { pages } = await sharp(buffer, readOpts).metadata();

    // Animated images are re-encoded but NOT resized: sharp's resize operates on the
    // vertically-stacked frame strip, and getting that wrong corrupts the animation.
    // Metadata still gets stripped, which is the security-relevant part. The 2 MB
    // upload cap is what bounds their size.
    if ((pages ?? 1) > 1) {
        return encode(sharp(buffer, readOpts), mimeType).toBuffer();
    }

    // `.rotate()` with no argument bakes in the EXIF Orientation tag BEFORE the
    // metadata is dropped. Without it, stripping EXIF would leave every photo a
    // phone recorded sideways displaying sideways.
    return encode(
        sharp(buffer, { failOn: 'none' })
            .rotate()
            .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true }),
        mimeType,
    ).toBuffer();
}
