import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config before importing the module
vi.mock('../../src/config', () => ({
    config: {
        shopify: {
            tokenEncryptionKey: 'test-encryption-key-must-be-32-chars-long!!',
        },
    },
}));

import { encrypt, decrypt } from '../../src/services/shopifyCrypto';

describe('shopifyCrypto', () => {
    describe('encrypt', () => {
        it('should return ciphertext and iv', () => {
            const result = encrypt('shpat_test_token_12345');
            expect(result).toHaveProperty('ciphertext');
            expect(result).toHaveProperty('iv');
            expect(result.ciphertext).toBeTruthy();
            expect(result.iv).toBeTruthy();
        });

        it('should not return plaintext', () => {
            const plaintext = 'shpat_test_token_12345';
            const result = encrypt(plaintext);
            expect(result.ciphertext).not.toContain(plaintext);
        });

        it('should produce different ciphertext for same input (random IV)', () => {
            const plaintext = 'shpat_test_token_12345';
            const result1 = encrypt(plaintext);
            const result2 = encrypt(plaintext);
            // IVs should differ
            expect(result1.iv).not.toBe(result2.iv);
        });

        it('should include auth tag in ciphertext (dot-separated)', () => {
            const result = encrypt('test');
            expect(result.ciphertext).toContain('.');
            const parts = result.ciphertext.split('.');
            expect(parts).toHaveLength(2);
        });
    });

    describe('decrypt', () => {
        it('should roundtrip encrypt/decrypt', () => {
            const plaintext = 'shpat_test_token_12345';
            const { ciphertext, iv } = encrypt(plaintext);
            const decrypted = decrypt(ciphertext, iv);
            expect(decrypted).toBe(plaintext);
        });

        it('should handle empty string', () => {
            const { ciphertext, iv } = encrypt('');
            const decrypted = decrypt(ciphertext, iv);
            expect(decrypted).toBe('');
        });

        it('should handle long tokens', () => {
            const longToken = 'shpat_' + 'a'.repeat(200);
            const { ciphertext, iv } = encrypt(longToken);
            const decrypted = decrypt(ciphertext, iv);
            expect(decrypted).toBe(longToken);
        });

        it('should handle unicode characters', () => {
            const unicodeText = 'token_مفتاح_テスト';
            const { ciphertext, iv } = encrypt(unicodeText);
            const decrypted = decrypt(ciphertext, iv);
            expect(decrypted).toBe(unicodeText);
        });

        it('should throw on tampered auth tag', () => {
            const { ciphertext, iv } = encrypt('test');
            // Replace the auth tag with a different value to guarantee GCM verification failure
            const [encData] = ciphertext.split('.');
            const fakeTag = Buffer.from('0'.repeat(16)).toString('base64');
            const tampered = encData + '.' + fakeTag;
            expect(() => decrypt(tampered, iv)).toThrow();
        });

        it('should throw on wrong IV', () => {
            const { ciphertext } = encrypt('test');
            const wrongIv = '0'.repeat(32); // 16 bytes in hex
            expect(() => decrypt(ciphertext, wrongIv)).toThrow();
        });

        it('should throw on invalid ciphertext format', () => {
            const validIv = '0'.repeat(32); // valid 16-byte hex IV
            expect(() => decrypt('no-dot-separator', validIv)).toThrow('Invalid ciphertext format');
        });
    });
});
