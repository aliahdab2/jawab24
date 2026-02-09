import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
    const key = config.shopify.tokenEncryptionKey;
    if (!key || key.length < 32) {
        throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY must be at least 32 characters');
    }
    // Use first 32 bytes of the key (SHA-256 hash if longer)
    return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt plaintext using AES-256-GCM
 * Returns ciphertext (base64) and iv (hex)
 */
export function encrypt(plaintext: string): { ciphertext: string; iv: string } {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    // Append auth tag to ciphertext
    return {
        ciphertext: encrypted + '.' + authTag.toString('base64'),
        iv: iv.toString('hex'),
    };
}

/**
 * Decrypt ciphertext using AES-256-GCM
 */
export function decrypt(ciphertext: string, iv: string): string {
    const key = getKey();
    const ivBuf = Buffer.from(iv, 'hex');

    const parts = ciphertext.split('.');
    if (parts.length !== 2) {
        throw new Error('Invalid ciphertext format');
    }

    const [encryptedData, authTagB64] = parts;
    const authTag = Buffer.from(authTagB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}
