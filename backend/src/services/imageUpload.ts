/**
 * ONE validation + normalization pipeline for every base64 image a merchant
 * uploads (Post Reply trigger images, Sham Cash receipts, …).
 *
 * allowlist → decode → non-empty → size cap → magic bytes match the declared
 * type → `normalizeImage` (re-encode: strips EXIF/GPS, bakes orientation,
 * bounds dimensions, guards decompression bombs).
 *
 * Extracted because the Post Reply controller and the Sham Cash controller
 * carried the same nine steps line for line with different error strings —
 * the third copy would have been the one that forgot the EXIF strip. Callers
 * map `code` to their own HTTP status/message; the Sentry call for a decode
 * failure lives here so every surface reports it the same way.
 */
import { UPLOADED_IMAGE_MIME_TYPES } from '@jawab24/shared';
import { bufferMatchesMime } from './kb/file-extractor';
import { normalizeImage } from './imageNormalize';
import { captureError } from '../utils/sentryHelpers';

export type UploadedImageCode =
    | 'unsupported_image_type'
    | 'invalid_image'
    | 'image_too_large'
    | 'file_content_mismatch'
    | 'image_unreadable';

export type ValidatedUpload =
    | { ok: true; bytes: Buffer; mimeType: string; originalBytes: number }
    | { ok: false; code: UploadedImageCode };

export async function validateAndNormalizeUpload(input: {
    base64: unknown;
    mimeType: unknown;
    maxBytes: number;
    /** Sentry identity for a decode failure: fingerprint + tags + extra. */
    sentry: { message: string; fingerprint: string; tags?: Record<string, string>; extra?: Record<string, unknown> };
}): Promise<ValidatedUpload> {
    const mimeType = typeof input.mimeType === 'string' ? input.mimeType : '';
    if (!(UPLOADED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
        return { ok: false, code: 'unsupported_image_type' };
    }
    if (typeof input.base64 !== 'string' || input.base64.length === 0) {
        return { ok: false, code: 'invalid_image' };
    }
    const buffer = Buffer.from(input.base64, 'base64');
    if (buffer.length === 0) return { ok: false, code: 'invalid_image' };
    if (buffer.length > input.maxBytes) return { ok: false, code: 'image_too_large' };
    if (!bufferMatchesMime(buffer, mimeType)) return { ok: false, code: 'file_content_mismatch' };
    try {
        const bytes = await normalizeImage(buffer, mimeType);
        return { ok: true, bytes, mimeType, originalBytes: buffer.length };
    } catch (err) {
        // A merchant uploading an odd file is expected and low-volume; sharp
        // failing for everyone (bad deploy, missing native binary) is not. Log at
        // warning so the two are distinguishable.
        captureError(err, input.sentry.message, {
            level: 'warning',
            fingerprint: [input.sentry.fingerprint],
            tags: { component: 'imageNormalize', ...(input.sentry.tags ?? {}) },
            extra: { ...(input.sentry.extra ?? {}), mimeType, bytes: buffer.length },
        });
        return { ok: false, code: 'image_unreadable' };
    }
}
