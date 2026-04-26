import { describe, it, expect } from 'vitest';
import { normalizeArabic } from '@jawab24/shared';
import {
    hasExternalPromoUrl,
    hasSpamKeyword,
    EMOJI_ONLY,
    PUNCTUATION_ONLY,
    MENTION_PATTERN,
} from '../../../src/services/reply/spamPatterns';

describe('hasExternalPromoUrl', () => {
    it('matches a Facebook group invite', () => {
        expect(hasExternalPromoUrl('join us https://www.facebook.com/groups/1416016389339694')).toBe(true);
    });

    it('matches a Telegram channel link', () => {
        expect(hasExternalPromoUrl('subscribe https://t.me/somechannel')).toBe(true);
    });

    it('matches a WhatsApp group invite (chat.whatsapp.com)', () => {
        expect(hasExternalPromoUrl('https://chat.whatsapp.com/ABC123')).toBe(true);
    });

    it('matches wa.me direct-DM links', () => {
        expect(hasExternalPromoUrl('wa.me/9665xxxxx')).toBe(true);
    });

    it('matches api.whatsapp.com links', () => {
        expect(hasExternalPromoUrl('https://api.whatsapp.com/send?phone=9665xxxxx')).toBe(true);
    });

    it('matches Discord invites', () => {
        expect(hasExternalPromoUrl('come hang out https://discord.gg/abcdef')).toBe(true);
    });

    it('matches fb.com group links', () => {
        expect(hasExternalPromoUrl('http://fb.com/groups/12345')).toBe(true);
    });

    it('is case-insensitive on the host', () => {
        expect(hasExternalPromoUrl('https://Facebook.com/Groups/1234')).toBe(true);
        expect(hasExternalPromoUrl('https://T.ME/channel')).toBe(true);
    });

    it('does NOT match a regular Facebook page URL (could be a legitimate reference)', () => {
        expect(hasExternalPromoUrl('https://www.facebook.com/MyPage/posts/12345')).toBe(false);
    });

    it('does NOT match instagram.com (too risky — customer might link the page IG)', () => {
        expect(hasExternalPromoUrl('https://instagram.com/mybrand')).toBe(false);
    });

    it('does NOT match an unrelated URL', () => {
        expect(hasExternalPromoUrl('see https://example.com/article')).toBe(false);
    });

    it('does NOT match plain text without a URL', () => {
        expect(hasExternalPromoUrl('كم سعر الدورة؟')).toBe(false);
    });
});

describe('hasSpamKeyword', () => {
    it('matches English self-promo keywords', () => {
        expect(hasSpamKeyword('check my profile', '')).toBe(true);
        expect(hasSpamKeyword('follow me on insta', '')).toBe(true);
        expect(hasSpamKeyword('link in bio', '')).toBe(true);
    });

    it('matches Arabic spam keywords against the normalised form', () => {
        const text = 'منشن صديقك';
        expect(hasSpamKeyword(text.toLowerCase(), normalizeArabic(text))).toBe(true);
    });

    it('matches franco-Arabic transliteration spam', () => {
        expect(hasSpamKeyword('folo me', '')).toBe(true);
    });

    it('does NOT match a legitimate question', () => {
        const text = 'كم سعر الدورة؟';
        expect(hasSpamKeyword(text.toLowerCase(), normalizeArabic(text))).toBe(false);
    });
});

describe('low-level pattern primitives', () => {
    it('PUNCTUATION_ONLY matches dots/ellipsis/Arabic question mark', () => {
        expect(PUNCTUATION_ONLY.test('...')).toBe(true);
        expect(PUNCTUATION_ONLY.test('؟')).toBe(true);
        expect(PUNCTUATION_ONLY.test('hi')).toBe(false);
    });

    it('EMOJI_ONLY matches strings containing only emoji + whitespace', () => {
        expect(EMOJI_ONLY.test('😂😂😂')).toBe(true);
        expect(EMOJI_ONLY.test('hi 😂')).toBe(false);
    });

    it('MENTION_PATTERN detects @handle', () => {
        expect(MENTION_PATTERN.test('@friend look')).toBe(true);
        expect(MENTION_PATTERN.test('no handle here')).toBe(false);
    });
});
