import crypto from 'crypto';
import { config } from '../config';

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

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';

function getKey(): Buffer {
    const key = config.facebook.tokenEncryptionKey;
    if (!key || key.length < 32) {
        throw new Error('FACEBOOK_TOKEN_ENCRYPTION_KEY must be at least 32 characters');
    }
    return crypto.createHash('sha256').update(key).digest();
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
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('hex')}:${encrypted}.${authTag.toString('base64')}`;
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
    const rest = body.slice(colonIdx + 1); // "<ciphertext_b64>.<authtag_b64>"

    if (!/^[0-9a-f]{32}$/i.test(ivHex)) throw new Error('Invalid IV in encrypted token');

    const dotIdx = rest.lastIndexOf('.');
    if (dotIdx === -1) throw new Error('Invalid encrypted token format (missing dot)');

    const ciphertextB64 = rest.slice(0, dotIdx);
    const authTagB64 = rest.slice(dotIdx + 1);
    const authTag = Buffer.from(authTagB64, 'base64');
    if (authTag.length !== AUTH_TAG_LENGTH) throw new Error('Invalid auth tag length');

    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertextB64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
