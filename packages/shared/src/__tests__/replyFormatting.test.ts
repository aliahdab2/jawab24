import { describe, it, expect } from 'vitest';
import { renderReplyForChannel } from '../replyFormatting';
import { LRI, PDI } from '../bidi';

const CANONICAL = '## التنانير المتوفرة\n**تنورة 79 ريال** — __مخزون قليل__ ~~124~~\n[اطلبيها من هنا](https://demostore.salla.sa/dev-x/تنورة/p812874023)\nالسعر 3*2 قطع، تابعينا @gulf_fashion';

describe('renderReplyForChannel', () => {
    it('plain: every marker removed, links become "label: url", single * and _ untouched', () => {
        expect(renderReplyForChannel(CANONICAL, 'plain')).toBe(
            'التنانير المتوفرة\nتنورة 79 ريال — مخزون قليل 124\nاطلبيها من هنا: https://demostore.salla.sa/dev-x/تنورة/p812874023\nالسعر 3*2 قطع، تابعينا @gulf_fashion',
        );
    });

    it("whatsapp: markdown translated to WhatsApp's own markup, links still plain", () => {
        expect(renderReplyForChannel(CANONICAL, 'whatsapp')).toBe(
            '*التنانير المتوفرة*\n*تنورة 79 ريال* — _مخزون قليل_ ~124~\nاطلبيها من هنا: https://demostore.salla.sa/dev-x/تنورة/p812874023\nالسعر 3*2 قطع، تابعينا @gulf_fashion',
        );
    });

    it('PROD 2026-08-23: the markdown "image" of a product page becomes the bare URL on both targets', () => {
        const prod = 'هذه صورة الفستان:\n![فستان](https://demostore.salla.sa/dev-x/فستان/p348732197)';
        const want = 'هذه صورة الفستان:\nhttps://demostore.salla.sa/dev-x/فستان/p348732197';
        expect(renderReplyForChannel(prod, 'plain')).toBe(want);
        expect(renderReplyForChannel(prod, 'whatsapp')).toBe(want);
    });

    it('text with no markup and no bidi-fragile number is byte-identical on both targets', () => {
        const plain = 'أهلاً! التوصيل خلال 3 أيام عمل، والدفع عند الاستلام متاح. رابط المتجر: https://gulf-fashion.salla.sa';
        expect(renderReplyForChannel(plain, 'plain')).toBe(plain);
        expect(renderReplyForChannel(plain, 'whatsapp')).toBe(plain);
        expect(renderReplyForChannel('', 'plain')).toBe('');
    });

    it('isolates a bidi-fragile number on both targets — «3-5» is displayed «5-3» without it', () => {
        const plain = 'أهلاً! التوصيل 3-5 أيام عمل.';
        const want = `أهلاً! التوصيل ${LRI}3-5${PDI} أيام عمل.`;
        expect(renderReplyForChannel(plain, 'plain')).toBe(want);
        expect(renderReplyForChannel(plain, 'whatsapp')).toBe(want);
    });

    it('a heading marker mid-line is not a heading', () => {
        expect(renderReplyForChannel('رقم الطلب #1234 جاهز', 'plain')).toBe('رقم الطلب #1234 جاهز');
    });
});
