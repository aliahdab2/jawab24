import { describe, it, expect } from 'vitest';
import { stripMarkdownLinks } from '../markdownLinks';

// The two shapes that reached customers on 2026-08-23 (Salla page, Messenger DM).
const PROD_IMAGE = 'هذه صورة الفستان المتوفر حالياً بسعر 83 ريال ومقاسات من XS إلى XL:\n![فستان](https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/فستان/p348732197)';
const PROD_LINKS = 'أكيد، هذي صورة التنانير اللي ذكرتها:\n[تنورة 79 ريال](https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p812874023)\n[تنورة 83 ريال](https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p1437926444)';

describe('stripMarkdownLinks', () => {
    it('PROD 2026-08-23: an image in markdown syntax becomes its bare URL', () => {
        expect(stripMarkdownLinks(PROD_IMAGE)).toBe(
            'هذه صورة الفستان المتوفر حالياً بسعر 83 ريال ومقاسات من XS إلى XL:\nhttps://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/فستان/p348732197',
        );
    });

    it('PROD 2026-08-23: markdown links become "label: url", every one of them', () => {
        expect(stripMarkdownLinks(PROD_LINKS)).toBe(
            'أكيد، هذي صورة التنانير اللي ذكرتها:\nتنورة 79 ريال: https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p812874023\nتنورة 83 ريال: https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw/تنورة/p1437926444',
        );
    });

    it('a label that is the url itself is not doubled', () => {
        expect(stripMarkdownLinks('[https://x.sa/p1](https://x.sa/p1)')).toBe('https://x.sa/p1');
    });

    it('leaves text without markdown byte-identical — including bare URLs and brackets', () => {
        const plain = 'رابط المنتج: https://gulf-fashion.salla.sa/classic-black-abaya/p1000 [متوفر] (مقاس M)';
        expect(stripMarkdownLinks(plain)).toBe(plain);
        expect(stripMarkdownLinks('')).toBe('');
    });

    it('does not touch emphasis or arithmetic — only link and image syntax', () => {
        expect(stripMarkdownLinks('السعر **350** ريال، 3*2 قطع')).toBe('السعر **350** ريال، 3*2 قطع');
    });

    it('ignores a non-http target (a relative or javascript: "link" is left as text)', () => {
        expect(stripMarkdownLinks('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
    });
});
