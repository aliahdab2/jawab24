import crypto from 'crypto';

/**
 * Constant-time verification of an HTTP Basic `Authorization` header against an
 * expected username/password pair.
 *
 * Zid webhook deliveries are authenticated this way: the subscription is created
 * with `username`/`password` fields and Zid sends every delivery with
 * `Authorization: Basic base64(username:password)` — there is no HMAC signature
 * header (unlike Salla/Shopify). See docs/integrations/zid.md.
 *
 * Comparison is timing-safe over the full header value (same discipline as
 * utils/hmacVerify.ts): length mismatch short-circuits to false, equal lengths
 * go through crypto.timingSafeEqual.
 */
export function verifyBasicAuthHeader(
    header: string | undefined | null,
    username: string,
    password: string,
): boolean {
    if (!header || !username || !password) return false;

    const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const providedBuf = Buffer.from(header);
    const expectedBuf = Buffer.from(expected);

    if (providedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
