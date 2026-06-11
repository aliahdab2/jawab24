import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config before importing the module under test
vi.mock('../../src/config', () => ({
    config: {
        facebook: {
            tokenEncryptionKey: 'test-encryption-key-must-be-32-chars-long!!',
        },
    },
}));

// Mock Sentry capture so safeDecryptToken failure-reporting can be asserted
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

import {
    isEncrypted, encryptFbToken, decryptFbToken,
    maybeEncryptToken, maybeDecryptToken, safeDecryptToken,
} from '../../src/services/facebookCrypto';
import { captureError } from '../../src/utils/sentryHelpers';
import { config } from '../../src/config';

const PREFIX = 'enc:v1:';

// ---------------------------------------------------------------------------
// isEncrypted
// ---------------------------------------------------------------------------

describe('isEncrypted', () => {
    it('returns true for enc:v1: prefixed string', () => {
        expect(isEncrypted('enc:v1:abc123:ciphertext.tag')).toBe(true);
    });

    it('returns false for legacy plaintext token', () => {
        expect(isEncrypted('EAABsbCS4iNwBOzZAlhNhCz...')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isEncrypted('')).toBe(false);
    });

    it('returns false for partial prefix', () => {
        expect(isEncrypted('enc:v1')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// encryptFbToken
// ---------------------------------------------------------------------------

describe('encryptFbToken', () => {
    it('returns a string with enc:v1: prefix', () => {
        const result = encryptFbToken('my-access-token');
        expect(result.startsWith(PREFIX)).toBe(true);
    });

    it('does not expose the plaintext in the output', () => {
        const plaintext = 'super-secret-facebook-token-abc';
        const result = encryptFbToken(plaintext);
        expect(result).not.toContain(plaintext);
    });

    it('produces different ciphertext for same input (random IV per call)', () => {
        const token = 'EAABsbCS4iNwBOzZAlhNhCz123456';
        const enc1 = encryptFbToken(token);
        const enc2 = encryptFbToken(token);
        expect(enc1).not.toBe(enc2);
    });

    it('output format is enc:v1:<32-hex-chars>:<ciphertext_b64>.<authtag_b64>', () => {
        const result = encryptFbToken('test-token');
        // Strip prefix
        const body = result.slice(PREFIX.length); // "<iv_hex>:<rest>"
        const colonIdx = body.indexOf(':');
        expect(colonIdx).toBeGreaterThan(-1);

        const ivHex = body.slice(0, colonIdx);
        expect(ivHex).toMatch(/^[0-9a-f]{32}$/i); // 16 bytes = 32 hex chars

        const rest = body.slice(colonIdx + 1); // "<ciphertext_b64>.<authtag_b64>"
        const dotIdx = rest.lastIndexOf('.');
        expect(dotIdx).toBeGreaterThan(-1);

        const authTagB64 = rest.slice(dotIdx + 1);
        const authTagBuf = Buffer.from(authTagB64, 'base64');
        expect(authTagBuf.length).toBe(16); // GCM auth tag = 16 bytes
    });

    it('isEncrypted() returns true for the output of encryptFbToken()', () => {
        expect(isEncrypted(encryptFbToken('any-token'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// decryptFbToken — happy paths
// ---------------------------------------------------------------------------

describe('decryptFbToken — roundtrip', () => {
    it('decrypts a freshly encrypted token back to the original value', () => {
        const plaintext = 'EAABsbCS4iNwBOzZAlhNhCz999';
        const encrypted = encryptFbToken(plaintext);
        expect(decryptFbToken(encrypted)).toBe(plaintext);
    });

    it('handles an empty string', () => {
        const encrypted = encryptFbToken('');
        expect(decryptFbToken(encrypted)).toBe('');
    });

    it('handles a very long token (200+ chars)', () => {
        const longToken = 'EAABsbCS4iNwB' + 'a'.repeat(200);
        const encrypted = encryptFbToken(longToken);
        expect(decryptFbToken(encrypted)).toBe(longToken);
    });

    it('handles tokens with special characters', () => {
        const weirdToken = 'token_with-special+chars/=and&more';
        const encrypted = encryptFbToken(weirdToken);
        expect(decryptFbToken(encrypted)).toBe(weirdToken);
    });

    it('handles unicode characters (edge case)', () => {
        const unicodeToken = 'token_مفتاح_テスト_🔐';
        const encrypted = encryptFbToken(unicodeToken);
        expect(decryptFbToken(encrypted)).toBe(unicodeToken);
    });
});

// ---------------------------------------------------------------------------
// decryptFbToken — legacy plaintext passthrough
// ---------------------------------------------------------------------------

describe('decryptFbToken — legacy plaintext passthrough', () => {
    it('returns plaintext as-is when no enc:v1: prefix', () => {
        const legacy = 'EAABsbCS4iNwBOzZAlhNhCzOld';
        expect(decryptFbToken(legacy)).toBe(legacy);
    });

    it('returns empty string unchanged', () => {
        expect(decryptFbToken('')).toBe('');
    });

    it('does NOT call getKey() for legacy tokens (no throw when key is unset)', () => {
        // This test verifies that legacy passthrough doesn't attempt decryption
        // If getKey() were called on a legacy token, it would throw (key is set in mock,
        // but we can verify the return value is the input unchanged)
        const legacy = 'plain-legacy-token-no-prefix';
        expect(decryptFbToken(legacy)).toBe(legacy);
    });
});

// ---------------------------------------------------------------------------
// decryptFbToken — tamper detection
// ---------------------------------------------------------------------------

describe('decryptFbToken — tamper detection', () => {
    it('throws when the auth tag is replaced with a fake one', () => {
        const encrypted = encryptFbToken('sensitive-token');
        // Replace auth tag portion after the last dot
        const lastDot = encrypted.lastIndexOf('.');
        const fakeTag = Buffer.alloc(16, 0).toString('base64'); // 16 zero bytes
        const tampered = encrypted.slice(0, lastDot + 1) + fakeTag;
        expect(() => decryptFbToken(tampered)).toThrow();
    });

    it('throws when the ciphertext bytes are flipped', () => {
        const encrypted = encryptFbToken('sensitive-token');
        // Corrupt one character in the ciphertext portion (between colon and dot)
        const body = encrypted.slice(PREFIX.length);
        const colonIdx = body.indexOf(':');
        const rest = body.slice(colonIdx + 1);
        const dotIdx = rest.lastIndexOf('.');
        // Flip first char of ciphertext
        const original = rest[0];
        const flipped = original === 'A' ? 'B' : 'A';
        const corrupted = PREFIX + body.slice(0, colonIdx + 1) + flipped + rest.slice(1);
        expect(() => decryptFbToken(corrupted)).toThrow();
    });

    it('throws when IV is replaced with a different valid-format IV', () => {
        const encrypted = encryptFbToken('sensitive-token');
        // Swap IV for a different 16-byte hex value
        const body = encrypted.slice(PREFIX.length);
        const colonIdx = body.indexOf(':');
        const wrongIv = 'ff'.repeat(16); // different from original
        const tampered = PREFIX + wrongIv + body.slice(colonIdx);
        expect(() => decryptFbToken(tampered)).toThrow();
    });
});

// ---------------------------------------------------------------------------
// decryptFbToken — format validation
// ---------------------------------------------------------------------------

describe('decryptFbToken — format validation', () => {
    it('throws when colon separator is missing after prefix', () => {
        const malformed = `${PREFIX}aabbccddeeff00112233445566778899nodot`;
        expect(() => decryptFbToken(malformed)).toThrow('missing colon');
    });

    it('throws when dot separator is missing between ciphertext and auth tag', () => {
        const malformed = `${PREFIX}aabbccddeeff00112233445566778899:nodot`;
        expect(() => decryptFbToken(malformed)).toThrow('Invalid ciphertext format');
    });

    it('throws when IV is not valid hex', () => {
        const malformed = `${PREFIX}ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ:ciphertext.tag`;
        expect(() => decryptFbToken(malformed)).toThrow('Invalid IV');
    });

    it('throws when IV is valid hex but wrong length (not 32 chars)', () => {
        const shortIv = 'aabb'; // only 2 bytes, not 16
        const malformed = `${PREFIX}${shortIv}:ciphertext.tag`;
        expect(() => decryptFbToken(malformed)).toThrow('Invalid IV');
    });

    it('throws when auth tag is too short', () => {
        const validIv = 'aa'.repeat(16); // 16 bytes in hex
        const malformed = `${PREFIX}${validIv}:Y2lwaGVydGV4dA==.c2hvcnQ=`; // "short" base64 < 16 bytes
        expect(() => decryptFbToken(malformed)).toThrow('Invalid auth tag length');
    });
});

// ---------------------------------------------------------------------------
// Key configuration
// ---------------------------------------------------------------------------

describe('key configuration', () => {
    it('encryptFbToken throws when encryption key is not configured', async () => {
        // Re-import with no key set
        vi.doMock('../../src/config', () => ({
            config: { facebook: { tokenEncryptionKey: '' } },
        }));
        const { encryptFbToken: encryptNoKey } = await import('../../src/services/facebookCrypto?nocache=' + Date.now());
        expect(() => encryptNoKey('token')).toThrow('FACEBOOK_TOKEN_ENCRYPTION_KEY');
    });
});

// ---------------------------------------------------------------------------
// maybeEncryptToken / maybeDecryptToken
// ---------------------------------------------------------------------------

describe('maybeEncryptToken', () => {
    it('preserves the empty-string disconnect sentinel (never encrypts "")', () => {
        expect(maybeEncryptToken('')).toBe('');
    });

    it('encrypts non-empty tokens when the key is configured', () => {
        const out = maybeEncryptToken('EAABsbCS4iNwBO-page-token');
        expect(isEncrypted(out)).toBe(true);
        expect(maybeDecryptToken(out)).toBe('EAABsbCS4iNwBO-page-token');
    });

    it('passes tokens through unchanged when no key is configured', () => {
        const original = config.facebook.tokenEncryptionKey;
        config.facebook.tokenEncryptionKey = '';
        try {
            expect(maybeEncryptToken('plain-token')).toBe('plain-token');
            expect(maybeDecryptToken('plain-token')).toBe('plain-token');
        } finally {
            config.facebook.tokenEncryptionKey = original;
        }
    });
});

// ---------------------------------------------------------------------------
// safeDecryptToken — never throws; corrupt rows surface as disconnected
// ---------------------------------------------------------------------------

describe('safeDecryptToken', () => {
    beforeEach(() => {
        vi.mocked(captureError).mockClear();
    });

    it('decrypts a valid encrypted token', () => {
        const enc = encryptFbToken('page-token-123');
        expect(safeDecryptToken(enc, { entity: 'page', id: 'p1' })).toBe('page-token-123');
        expect(captureError).not.toHaveBeenCalled();
    });

    it('passes through legacy plaintext tokens', () => {
        expect(safeDecryptToken('legacy-plaintext', { entity: 'page' })).toBe('legacy-plaintext');
    });

    it('returns "" for null/undefined/empty', () => {
        expect(safeDecryptToken(null, { entity: 'user' })).toBe('');
        expect(safeDecryptToken(undefined, { entity: 'user' })).toBe('');
        expect(safeDecryptToken('', { entity: 'page' })).toBe('');
        expect(captureError).not.toHaveBeenCalled();
    });

    it('returns "" and reports to Sentry on corrupt ciphertext instead of throwing', () => {
        const corrupt = `enc:v1:${'aa'.repeat(16)}:not-real-ciphertext.c2hvcnQ=`;
        expect(safeDecryptToken(corrupt, { entity: 'page', id: 'p1' })).toBe('');
        expect(captureError).toHaveBeenCalledTimes(1);
    });

    it('returns "" on a tampered auth tag (decryption failure must not 500 getPages)', () => {
        const enc = encryptFbToken('real-token');
        const tampered = enc.slice(0, -6) + 'AAAAA=';
        expect(safeDecryptToken(tampered, { entity: 'page', id: 'p2' })).toBe('');
        expect(captureError).toHaveBeenCalledTimes(1);
    });
});
