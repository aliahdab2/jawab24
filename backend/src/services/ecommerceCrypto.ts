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

/**
 * Encrypt an optional secret (e.g. an OAuth refresh token). Returns an empty
 * object when the value is absent — Shopify offline tokens have no refresh
 * token — so callers can persist the result without branching on presence.
 */
export function encryptOptional(plaintext?: string | null): { ciphertext?: string; iv?: string } {
    if (!plaintext) return {};
    return aesGcmEncrypt(plaintext, getKey());
}

/**
 * Decrypt an optional secret. Returns undefined when either part is missing —
 * Shopify rows and pending installs created before refresh-token support have
 * no refresh token — so callers never attempt a decrypt on a null pair.
 */
export function decryptOptional(ciphertext?: string | null, iv?: string | null): string | undefined {
    if (!ciphertext || !iv) return undefined;
    return aesGcmDecrypt(ciphertext, iv, getKey());
}
