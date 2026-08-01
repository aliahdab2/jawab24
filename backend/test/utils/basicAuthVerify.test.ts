import { describe, it, expect } from 'vitest';
import { verifyBasicAuthHeader } from '../../src/utils/basicAuthVerify';

/**
 * Timing-safe HTTP Basic verification — used for Zid webhook deliveries, which
 * are authenticated with the username/password pair set at subscription time
 * (there is no HMAC signature header).
 */

const USER = 'jawab24';
const PASS = 'super_secret_password';

function basicHeader(user: string, pass: string): string {
    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('verifyBasicAuthHeader', () => {
    it('accepts the exact expected header', () => {
        expect(verifyBasicAuthHeader(basicHeader(USER, PASS), USER, PASS)).toBe(true);
    });

    it('rejects a wrong password', () => {
        expect(verifyBasicAuthHeader(basicHeader(USER, 'wrong_password_x'), USER, PASS)).toBe(false);
    });

    it('rejects a wrong username', () => {
        expect(verifyBasicAuthHeader(basicHeader('someone', PASS), USER, PASS)).toBe(false);
    });

    it('rejects a missing header (fails closed)', () => {
        expect(verifyBasicAuthHeader(undefined, USER, PASS)).toBe(false);
        expect(verifyBasicAuthHeader(null, USER, PASS)).toBe(false);
        expect(verifyBasicAuthHeader('', USER, PASS)).toBe(false);
    });

    it('rejects when the expected username or password is not configured (fails closed)', () => {
        const header = basicHeader(USER, PASS);
        expect(verifyBasicAuthHeader(header, '', PASS)).toBe(false);
        expect(verifyBasicAuthHeader(header, USER, '')).toBe(false);
    });

    it('rejects a bare credential without the Basic scheme prefix', () => {
        const bare = Buffer.from(`${USER}:${PASS}`).toString('base64');
        expect(verifyBasicAuthHeader(bare, USER, PASS)).toBe(false);
    });

    it('rejects a different auth scheme', () => {
        expect(verifyBasicAuthHeader(`Bearer ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`, USER, PASS)).toBe(false);
    });

    it('compares the full header value — same-length near-misses are rejected', () => {
        // Same length as the valid header, differing in the payload: exercises the
        // crypto.timingSafeEqual branch (equal lengths), not the length short-circuit.
        const valid = basicHeader(USER, PASS);
        const nearMiss = basicHeader(USER, 'super_secret_passworX');
        expect(nearMiss).toHaveLength(valid.length);
        expect(verifyBasicAuthHeader(nearMiss, USER, PASS)).toBe(false);
    });

    it('short-circuits on length mismatch without throwing (timingSafeEqual needs equal lengths)', () => {
        expect(verifyBasicAuthHeader('Basic x', USER, PASS)).toBe(false);
        expect(verifyBasicAuthHeader(`${basicHeader(USER, PASS)}extra`, USER, PASS)).toBe(false);
    });

    it('handles multibyte credentials (UTF-8 password)', () => {
        const utf8Pass = 'كلمة_سر_قوية_1234';
        expect(verifyBasicAuthHeader(basicHeader(USER, utf8Pass), USER, utf8Pass)).toBe(true);
        expect(verifyBasicAuthHeader(basicHeader(USER, utf8Pass), USER, PASS)).toBe(false);
    });
});
