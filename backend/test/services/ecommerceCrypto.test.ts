import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must set env before importing the module
const TEST_KEY = 'a]very-long-encryption-key-for-testing-at-least-32-chars!';

describe('EcommerceCrypto', () => {
    const originalEnv = process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY;

    beforeEach(() => {
        process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY = TEST_KEY;
        vi.resetModules();
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY = originalEnv;
        } else {
            delete process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY;
        }
    });

    it('should encrypt and decrypt a string', async () => {
        const { encrypt, decrypt } = await import('../../src/services/ecommerceCrypto');

        const plaintext = 'my-secret-access-token';
        const { ciphertext, iv } = encrypt(plaintext);

        expect(ciphertext).toBeDefined();
        expect(iv).toBeDefined();
        expect(ciphertext).not.toBe(plaintext);

        const decrypted = decrypt(ciphertext, iv);
        expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
        const { encrypt } = await import('../../src/services/ecommerceCrypto');

        const result1 = encrypt('same-text');
        const result2 = encrypt('same-text');

        expect(result1.ciphertext).not.toBe(result2.ciphertext);
        expect(result1.iv).not.toBe(result2.iv);
    });

    it('should handle empty string', async () => {
        const { encrypt, decrypt } = await import('../../src/services/ecommerceCrypto');

        const { ciphertext, iv } = encrypt('');
        const decrypted = decrypt(ciphertext, iv);
        expect(decrypted).toBe('');
    });

    it('should handle unicode text', async () => {
        const { encrypt, decrypt } = await import('../../src/services/ecommerceCrypto');

        const plaintext = 'مرحبا بالعالم 🌍';
        const { ciphertext, iv } = encrypt(plaintext);
        const decrypted = decrypt(ciphertext, iv);
        expect(decrypted).toBe(plaintext);
    });

    it('should throw on invalid IV format', async () => {
        const { encrypt, decrypt } = await import('../../src/services/ecommerceCrypto');

        const { ciphertext } = encrypt('test');

        expect(() => decrypt(ciphertext, 'bad-iv')).toThrow('Invalid IV format');
    });

    it('should throw on invalid ciphertext format (no dot)', async () => {
        const { encrypt, decrypt } = await import('../../src/services/ecommerceCrypto');

        const { iv } = encrypt('test');

        expect(() => decrypt('no-dot-separator', iv)).toThrow('Invalid ciphertext format');
    });

    it('should throw when key is too short', async () => {
        process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY = 'short';
        vi.resetModules();

        const { encrypt } = await import('../../src/services/ecommerceCrypto');

        expect(() => encrypt('test')).toThrow('must be at least 32 characters');
    });

    it('should throw when key is missing', async () => {
        delete process.env.ECOMMERCE_TOKEN_ENCRYPTION_KEY;
        vi.resetModules();

        // Also need to mock config to return empty shopify key
        vi.doMock('../../src/config', () => ({
            config: { shopify: { tokenEncryptionKey: '' } },
        }));

        const { encrypt } = await import('../../src/services/ecommerceCrypto');

        expect(() => encrypt('test')).toThrow('must be at least 32 characters');
    });

    describe('encryptOptional / decryptOptional', () => {
        it('encryptOptional returns an empty object for absent values (Shopify has no refresh token)', async () => {
            const { encryptOptional } = await import('../../src/services/ecommerceCrypto');

            expect(encryptOptional(undefined)).toEqual({});
            expect(encryptOptional(null)).toEqual({});
            expect(encryptOptional('')).toEqual({});
        });

        it('encryptOptional round-trips through decrypt when a value is present', async () => {
            const { encryptOptional, decrypt } = await import('../../src/services/ecommerceCrypto');

            const { ciphertext, iv } = encryptOptional('salla_refresh_token');
            expect(ciphertext).toBeDefined();
            expect(iv).toBeDefined();
            expect(decrypt(ciphertext!, iv!)).toBe('salla_refresh_token');
        });

        it('decryptOptional returns undefined when either part is missing', async () => {
            const { decryptOptional, encrypt } = await import('../../src/services/ecommerceCrypto');
            const { ciphertext, iv } = encrypt('something');

            expect(decryptOptional(undefined, undefined)).toBeUndefined();
            expect(decryptOptional(null, null)).toBeUndefined();
            expect(decryptOptional(ciphertext, undefined)).toBeUndefined();
            expect(decryptOptional(undefined, iv)).toBeUndefined();
        });

        it('decryptOptional decrypts a full ciphertext + iv pair', async () => {
            const { encryptOptional, decryptOptional } = await import('../../src/services/ecommerceCrypto');

            const { ciphertext, iv } = encryptOptional('zid_refresh_token');
            expect(decryptOptional(ciphertext, iv)).toBe('zid_refresh_token');
        });
    });
});
