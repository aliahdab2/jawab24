import { describe, it, expect } from 'vitest';
import { shortcodeToMediaId, extractPostId, isSharedPostType } from '../../src/utils/instagram';

describe('shortcodeToMediaId', () => {
    it('converts a known Instagram shortcode to numeric ID', () => {
        // "BNhS" is a short example — algorithm: B=1, N=13, h=33, S=18
        // 1*64^3 + 13*64^2 + 33*64 + 18 = 262144 + 53248 + 2112 + 18 = 317522
        expect(shortcodeToMediaId('BNhS')).toBe('317522');
    });

    it('returns null for invalid characters', () => {
        expect(shortcodeToMediaId('invalid!chars')).toBeNull();
    });

    it('handles single character shortcodes', () => {
        expect(shortcodeToMediaId('A')).toBe('0');
        expect(shortcodeToMediaId('B')).toBe('1');
    });
});

describe('extractPostId', () => {
    it('prefers attachmentId when provided', () => {
        expect(extractPostId('https://facebook.com/posts/999', '12345')).toBe('12345');
    });

    it('ignores non-numeric attachmentId', () => {
        expect(extractPostId('https://facebook.com/posts/999', 'abc')).toBe('999');
    });

    it('extracts numeric ID from Facebook post URL', () => {
        expect(extractPostId('https://www.facebook.com/username/posts/123456789')).toBe('123456789');
    });

    it('extracts numeric ID from URL with query params', () => {
        expect(extractPostId('https://www.facebook.com/posts/123456789?ref=share')).toBe('123456789');
    });

    it('decodes Instagram shortcode from /p/ URL', () => {
        const result = extractPostId('https://www.instagram.com/p/BNhS/');
        expect(result).toBe('317522');
    });

    it('decodes Instagram shortcode from /reel/ URL', () => {
        const result = extractPostId('https://www.instagram.com/reel/BNhS/');
        expect(result).toBe('317522');
    });

    it('returns null when no URL or ID provided', () => {
        expect(extractPostId()).toBeNull();
        expect(extractPostId(undefined, undefined)).toBeNull();
    });

    it('returns null for unrecognized URL format', () => {
        expect(extractPostId('https://example.com/some/page')).toBeNull();
    });
});

describe('isSharedPostType', () => {
    it('returns true for post types', () => {
        expect(isSharedPostType('post')).toBe(true);
        expect(isSharedPostType('ig_post')).toBe(true);
    });

    it('returns true for reel types', () => {
        expect(isSharedPostType('reel')).toBe(true);
        expect(isSharedPostType('ig_reel')).toBe(true);
    });

    it('returns false for other attachment types', () => {
        expect(isSharedPostType('image')).toBe(false);
        expect(isSharedPostType('audio')).toBe(false);
        expect(isSharedPostType('video')).toBe(false);
        expect(isSharedPostType('file')).toBe(false);
        expect(isSharedPostType('fallback')).toBe(false);
    });
});
