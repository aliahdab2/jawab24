import { describe, it, expect } from 'vitest';
import { normalizeStoreDomain, storeBaseUrl } from '../../src/services/storeDomain';

/**
 * `store_domain` is an identity key (unique with `platform`, the createStore
 * ON CONFLICT target). These pin its canonical form — the 2026-08-23 defect was a
 * Salla domain stored as a full URL, rendered as `https://https://…`.
 */
describe('normalizeStoreDomain', () => {
    it('leaves a bare host alone', () => {
        expect(normalizeStoreDomain('mystore.salla.sa')).toBe('mystore.salla.sa');
    });

    it('strips the scheme', () => {
        expect(normalizeStoreDomain('https://mystore.salla.sa')).toBe('mystore.salla.sa');
        expect(normalizeStoreDomain('http://mystore.salla.sa')).toBe('mystore.salla.sa');
    });

    it('KEEPS the path — Salla demo/development stores live under one — and drops the trailing slash', () => {
        expect(normalizeStoreDomain('https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/')).toBe('demostore.salla.sa/dev-jkgsyu3w6pzzfrzw');
        expect(normalizeStoreDomain('https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw')).toBe('demostore.salla.sa/dev-jkgsyu3w6pzzfrzw');
    });

    it('lower-cases the host only; the path is a case-sensitive slug', () => {
        expect(normalizeStoreDomain('HTTPS://DemoStore.Salla.SA/Dev-AbC/')).toBe('demostore.salla.sa/Dev-AbC');
    });

    it('is idempotent', () => {
        const once = normalizeStoreDomain('https://demostore.salla.sa/dev-x/');
        expect(normalizeStoreDomain(once)).toBe(once);
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeStoreDomain('  https://x.salla.sa  ')).toBe('x.salla.sa');
    });
});

describe('storeBaseUrl', () => {
    it('prefixes https:// exactly once, whatever shape the stored value has', () => {
        expect(storeBaseUrl('mystore.salla.sa')).toBe('https://mystore.salla.sa');
        expect(storeBaseUrl('https://mystore.salla.sa')).toBe('https://mystore.salla.sa');
        expect(storeBaseUrl('https://demostore.salla.sa/dev-x/')).toBe('https://demostore.salla.sa/dev-x');
    });
});
