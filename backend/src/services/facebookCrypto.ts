import { config } from '../config';
import { aesGcmEncrypt, aesGcmDecrypt, deriveKey } from '../lib/aesGcm';

/**
 * Encrypt a page/user token if encryption key is configured.
 * Skips empty strings (sentinel for disconnected pages).
 */
export function maybeEncryptToken(token: string): string {
    if (!token || !config.facebook.tokenEncryptionKey) return token;
    return encryptFbToken(token);
}

/**
 * Decrypt a page/user token if encrypted.
 * Falls back to plaintext for legacy unencrypted tokens.
 */
export function maybeDecryptToken(token: string | null | undefined): string {
    if (!token) return '';
    if (!config.facebook.tokenEncryptionKey) return token;
    return decryptFbToken(token);
}

const PREFIX = 'enc:v1:';

function getKey(): Buffer {
    const key = config.facebook.tokenEncryptionKey;
    if (!key || key.length < 32) {
        throw new Error('FACEBOOK_TOKEN_ENCRYPTION_KEY must be at least 32 characters');
    }
    return deriveKey(key);
}

/**
 * Returns true if the stored value is an encrypted token.
 * Legacy plaintext tokens are detected by the absence of the prefix.
 */
export function isEncrypted(stored: string): boolean {
    return stored.startsWith(PREFIX);
}

/**
 * Encrypt a Facebook access token.
 * Bundles IV + ciphertext + auth tag into a single string so no schema change is needed.
 * Format: enc:v1:<iv_hex>:<ciphertext_b64>.<authtag_b64>
 */
export function encryptFbToken(plaintext: string): string {
    const { iv, ciphertext } = aesGcmEncrypt(plaintext, getKey());
    return `${PREFIX}${iv}:${ciphertext}`;
}

/**
 * Decrypt a Facebook access token.
 * Falls back to returning the value as-is for legacy plaintext tokens (no prefix).
 */
export function decryptFbToken(stored: string): string {
    if (!isEncrypted(stored)) {
        // Legacy plaintext token — return as-is
        return stored;
    }

    const body = stored.slice(PREFIX.length); // "<iv_hex>:<ciphertext_b64>.<authtag_b64>"
    const colonIdx = body.indexOf(':');
    if (colonIdx === -1) throw new Error('Invalid encrypted token format (missing colon)');

    const ivHex = body.slice(0, colonIdx);
    const ciphertext = body.slice(colonIdx + 1); // "<ciphertext_b64>.<authtag_b64>"

    return aesGcmDecrypt(ciphertext, ivHex, getKey());
}
