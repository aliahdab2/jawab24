import { describe, it, expect } from 'vitest';
import { isSafeRedirectPath } from '../utils/redirect';

describe('isSafeRedirectPath', () => {
    it('accepts a same-origin relative path', () => {
        expect(isSafeRedirectPath('/dashboard')).toBe(true);
        expect(isSafeRedirectPath('/settings?tab=billing')).toBe(true);
        expect(isSafeRedirectPath('/a/b/c#frag')).toBe(true);
    });

    it('rejects protocol-relative URLs (the open-redirect vector)', () => {
        expect(isSafeRedirectPath('//evil.com')).toBe(false);
        expect(isSafeRedirectPath('//evil.com/path')).toBe(false);
    });

    it('rejects backslash-tricked URLs browsers treat as external', () => {
        expect(isSafeRedirectPath('/\\evil.com')).toBe(false);
    });

    it('rejects absolute URLs and non-relative values', () => {
        expect(isSafeRedirectPath('https://evil.com')).toBe(false);
        expect(isSafeRedirectPath('http://evil.com')).toBe(false);
        expect(isSafeRedirectPath('javascript:alert(1)')).toBe(false);
        expect(isSafeRedirectPath('dashboard')).toBe(false);
    });

    it('rejects empty and non-string values', () => {
        expect(isSafeRedirectPath('')).toBe(false);
        expect(isSafeRedirectPath(undefined)).toBe(false);
        expect(isSafeRedirectPath(null)).toBe(false);
        expect(isSafeRedirectPath(['/dashboard'])).toBe(false);
        expect(isSafeRedirectPath(42)).toBe(false);
    });
});
