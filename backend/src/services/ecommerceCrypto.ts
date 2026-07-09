import { config } from '../config';
import { aesGcmEncrypt, aesGcmDecrypt, deriveKey } from '../lib/aesGcm';

// KEY INVARIANT: the encryption key is ECOMMERCE_TOKEN_ENCRYPTION_KEY, falling back
// to SHOPIFY_TOKEN_ENCRYPTION_KEY (config.shopify.tokenEncryptionKey) for backward
// compat with stores encrypted before the key was renamed. These two env vars MUST
// hold the SAME value — setting ECOMMERCE_TOKEN_ENCRYPTION_KEY to anything different
// from the historical SHOPIFY_TOKEN_ENCRYPTION_KEY makes every previously-stored token
// undecryptable (the derived key changes). This is the single crypto module for all
// e-commerce tokens (Shopify/Salla/Zid).
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
