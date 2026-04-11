import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { verifyHexHmac } from '../../src/utils/hmacVerify';

/** Produce the correct hex HMAC for a body+secret pair */
function makeHmac(body: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

describe('verifyHexHmac', () => {
    it('returns true for a valid signature', () => {
        const body = '{"event":"product.created"}';
        const secret = 'test-webhook-secret';
        const sig = makeHmac(body, secret);
        expect(verifyHexHmac(body, sig, secret)).toBe(true);
    });

    it('returns false for a tampered body', () => {
        const secret = 'test-webhook-secret';
        const sig = makeHmac('original body', secret);
        expect(verifyHexHmac('tampered body', sig, secret)).toBe(false);
    });

    it('returns false for a wrong secret', () => {
        const body = '{"event":"order.created"}';
        const sig = makeHmac(body, 'correct-secret');
        expect(verifyHexHmac(body, sig, 'wrong-secret')).toBe(false);
    });

    it('returns false when secret is undefined', () => {
        const body = 'some body';
        const sig = makeHmac(body, 'secret');
        expect(verifyHexHmac(body, sig, undefined)).toBe(false);
    });

    it('returns false when secret is an empty string', () => {
        const body = 'some body';
        const sig = makeHmac(body, '');
        expect(verifyHexHmac(body, sig, '')).toBe(false);
    });

    it('returns false when signature has different length', () => {
        const secret = 'test-secret';
        const body = 'body';
        // Truncate the correct signature to force a length mismatch
        const shortSig = makeHmac(body, secret).slice(0, 10);
        expect(verifyHexHmac(body, shortSig, secret)).toBe(false);
    });

    it('uses timing-safe comparison (does not throw on equal-length wrong sig)', () => {
        const secret = 'test-secret';
        const body = 'body';
        // Wrong signature of the same length (64 hex chars = 32 bytes)
        const wrongSig = 'a'.repeat(64);
        expect(() => verifyHexHmac(body, wrongSig, secret)).not.toThrow();
        expect(verifyHexHmac(body, wrongSig, secret)).toBe(false);
    });

    it('works with Arabic body content', () => {
        const body = '{"message":"مرحبا بك"}';
        const secret = 'arabic-test-secret';
        const sig = makeHmac(body, secret);
        expect(verifyHexHmac(body, sig, secret)).toBe(true);
    });
});
