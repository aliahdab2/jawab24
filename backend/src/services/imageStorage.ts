import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';

/**
 * Provider-agnostic object storage for merchant-uploaded images.
 *
 * DELIBERATELY THIN — the only public surface is `put` / `delete` / `isConfigured`.
 * No presigned URLs, no provider name, no path-style flags leak to callers: every
 * provider quirk stays sealed inside this file, driven purely by env. Swapping the
 * backing store (Backblaze B2 ⇄ Cloudflare R2 ⇄ AWS S3 ⇄ self-hosted MinIO) is an
 * env change with zero code change. If a caller ever needs to know which provider
 * is behind this, the abstraction has failed. See backend/docs/OBJECT_STORAGE.md.
 *
 * Reply-type-agnostic on purpose: Post Reply trigger images use it today, a future
 * "Smart Reply with image" feature reuses it as-is.
 */

export interface StoredObject {
    /** Publicly reachable URL (this is what Meta fetches). */
    url: string;
    /** Storage key — the handle used to delete the object later. */
    key: string;
}

/** Read config lazily (not destructured at module load) so a partial `config` mock
 *  in tests can't crash this module on import. Defaults keep every field a string. */
function cfg() {
    const c = config.objectStorage ?? {};
    return {
        endpoint: c.endpoint ?? '',
        region: c.region ?? 'us-east-1',
        bucket: c.bucket ?? '',
        accessKeyId: c.accessKeyId ?? '',
        secretAccessKey: c.secretAccessKey ?? '',
        publicBaseUrl: c.publicBaseUrl ?? '',
    };
}

/**
 * The feature is optional: it is enabled only when every required var is set.
 * When false, the rest of the app must boot and run normally — callers gate on this.
 */
export function isConfigured(): boolean {
    const { bucket, accessKeyId, secretAccessKey, publicBaseUrl } = cfg();
    return Boolean(bucket && accessKeyId && secretAccessKey && publicBaseUrl);
}

let client: S3Client | null = null;
function getClient(): S3Client {
    if (!client) {
        const { endpoint, region, accessKeyId, secretAccessKey } = cfg();
        client = new S3Client({
            region,
            credentials: { accessKeyId, secretAccessKey },
            // A custom endpoint means a non-AWS S3-compatible provider (B2/R2/MinIO),
            // which requires path-style addressing. Empty endpoint ⇒ real AWS S3.
            ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
        });
    }
    return client;
}

/** Strip a leading/trailing slash so `${base}/${key}` never doubles or drops a slash. */
function publicUrlFor(key: string): string {
    return `${cfg().publicBaseUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

/**
 * Upload an object and return its public URL + key. `ContentType` is always set so
 * the bucket serves a proper `image/*` response (Meta requires it). Throws on failure
 * — callers decide whether that aborts a save (upload) or is best-effort (delete).
 */
export async function put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await getClient().send(new PutObjectCommand({
        Bucket: cfg().bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
    }));
    return { url: publicUrlFor(key), key };
}

/**
 * Delete an object by key. Best-effort by contract: a delete failure leaves a
 * harmless orphan (swept by the audit script / lifecycle rule), never a missing
 * live image — so we log and swallow rather than throw. Returns whether it succeeded.
 */
export async function remove(key: string): Promise<boolean> {
    try {
        await getClient().send(new DeleteObjectCommand({ Bucket: cfg().bucket, Key: key }));
        return true;
    } catch (error) {
        captureError(error, 'ImageStorage: failed to delete object', {
            level: 'warning',
            fingerprint: ['image-storage-delete-failed'],
            tags: { component: 'imageStorage' },
            extra: { key },
        });
        return false;
    }
}

/** What a stored object's bytes came back as. */
export interface FetchedObject {
    body: Buffer;
    /** The object's own content type, as stored. Null when the store omitted it. */
    contentType: string | null;
}

/**
 * Read an object's bytes by key. Null when it does not exist.
 *
 * Exists so the app can SERVE a stored image itself instead of sending the
 * browser to the bucket. Displaying a bucket URL in an `<img>` needs no
 * permission, but downloading one does — the browser must `fetch` it, and that
 * requires CORS headers from the bucket. Ours sends none, so «حفظ الصورة» threw
 * `TypeError: Failed to fetch` on every press since the feature shipped.
 *
 * Proxying through our own origin removes the question entirely, and keeps this
 * module's promise: no presigned URLs and no provider quirks leak to callers
 * (a bucket CORS rule would have been provider config living outside the code,
 * lost on the next key rotation or bucket move — see OBJECT_STORAGE.md).
 */
export async function get(key: string): Promise<FetchedObject | null> {
    try {
        const res = await getClient().send(new GetObjectCommand({ Bucket: cfg().bucket, Key: key }));
        if (!res.Body) return null;
        // transformToByteArray is the SDK's own stream reader — it works the
        // same in Node and in tests, unlike hand-rolled stream collection.
        const bytes = await res.Body.transformToByteArray();
        return { body: Buffer.from(bytes), contentType: res.ContentType ?? null };
    } catch (error) {
        // A missing object is an ordinary outcome (a superseded post's image is
        // deleted on purpose), so it returns null rather than throwing. Anything
        // else is worth seeing, but still resolves to null: the caller's answer
        // is the same 404 either way.
        const name = (error as { name?: string }).name;
        if (name !== 'NoSuchKey' && name !== 'NotFound') {
            captureError(error, 'ImageStorage: failed to read object', {
                level: 'warning',
                fingerprint: ['image-storage-get-failed'],
                tags: { component: 'imageStorage' },
                extra: { key },
            });
        }
        return null;
    }
}

export const imageStorage = { isConfigured, put, remove, get };
