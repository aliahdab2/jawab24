import crypto from 'crypto';

/**
 * Verify a hex-encoded HMAC-SHA256 signature against a raw body string.
 *
 * Used by Salla and Zid webhooks — both sign payloads with SHA256 and send
 * a hex digest (unlike Shopify, which uses base64).
 *
 * Comparison is done with `timingSafeEqual` to prevent timing attacks.
 *
 * @returns `false` when `secret` is empty/undefined (treats missing config as failure)
 */
export function verifyHexHmac(body: string, signature: string, secret: string | undefined): boolean {
    if (!secret) return false;
    const hash = crypto
        .createHmac('sha256', secret)
        .update(body, 'utf8')
        .digest('hex');
    const hashBuf = Buffer.from(hash);
    const sigBuf = Buffer.from(signature);
    if (hashBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, sigBuf);
}
