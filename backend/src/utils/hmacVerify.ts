import crypto from 'crypto';

/**
 * Verify a hex-encoded HMAC-SHA256 signature against a raw body string.
 *
 * Used by SALLA webhooks, which sign payloads with SHA256 and send a hex
 * digest (unlike Shopify, which uses base64).
 *
 * ⛔ NOT used by Zid, despite what this comment claimed until 2026-09-04. Zid
 * does not sign its deliveries at all: per-store webhooks are authenticated
 * with an HTTP Basic credential and App Market lifecycle events carry no
 * credential whatsoever — see `verifyZidWebhookAuth` in controllers/zid.ts.
 * Do not "restore" a Zid call site here; there is no signature to verify.
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
