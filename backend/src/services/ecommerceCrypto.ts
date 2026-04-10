import { config } from '../config';
import { aesGcmEncrypt, aesGcmDecrypt, deriveKey } from '../lib/aesGcm';

function getKey(): Buffer {
    const key = process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY || config.shopify.tokenEncryptionKey;
    if (!key || key.length < 32) {
        throw new Error('ECOMMERCE_TOKEN_ENCRYPTION_KEY (or SHOPIFY_TOKEN_ENCRYPTION_KEY) must be at least 32 characters');
    }
    return deriveKey(key);
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns ciphertext (base64 with auth tag) and iv (hex).
 */
export function encrypt(plaintext: string): { ciphertext: string; iv: string } {
    return aesGcmEncrypt(plaintext, getKey());
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 */
export function decrypt(ciphertext: string, iv: string): string {
    return aesGcmDecrypt(ciphertext, iv, getKey());
}
