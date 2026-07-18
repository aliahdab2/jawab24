import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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

export const imageStorage = { isConfigured, put, remove };
