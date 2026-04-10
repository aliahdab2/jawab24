import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns the IV (hex) and ciphertext with auth tag appended (base64).
 * Format: `<ciphertext_b64>.<authtag_b64>`
 */
export function aesGcmEncrypt(plaintext: string, key: Buffer): { iv: string; ciphertext: string } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    return {
        iv: iv.toString('hex'),
        ciphertext: encrypted + '.' + authTag.toString('base64'),
    };
}

/**
 * Decrypt ciphertext produced by aesGcmEncrypt.
 * @param ciphertext `<ciphertext_b64>.<authtag_b64>`
 * @param ivHex      IV as 32-char hex string (16 bytes)
 * @param key        32-byte AES key
 */
export function aesGcmDecrypt(ciphertext: string, ivHex: string, key: Buffer): string {
    if (!/^[0-9a-f]{32}$/i.test(ivHex)) {
        throw new Error('Invalid IV format');
    }

    const dotIdx = ciphertext.lastIndexOf('.');
    if (dotIdx === -1) throw new Error('Invalid ciphertext format');

    const encryptedData = ciphertext.slice(0, dotIdx);
    const authTag = Buffer.from(ciphertext.slice(dotIdx + 1), 'base64');

    if (authTag.length !== AUTH_TAG_LENGTH) {
        throw new Error('Invalid auth tag length');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/** Derive a 32-byte key from an arbitrary-length secret using SHA-256. */
export function deriveKey(secret: string): Buffer {
    return crypto.createHash('sha256').update(secret).digest();
}
