/**
 * Deterministic high-stakes flag backstop (detectBusinessActionFlags).
 *
 * The AI model is told to flag cancel/refund/exchange intents, but it occasionally
 * misses a phrasing (eval #128 "ابي ابدل الجوال بلون ثاني" returned no flag). This
 * keyword detector guarantees those high-stakes intents are caught regardless of
 * the model, in Arabic and English — while NOT firing on generic complaints or
 * product questions (eval #131 / #132, which assert flagsAbsent).
 */
import { describe, it, expect } from 'vitest';
import { detectBusinessActionFlags } from '../../../src/services/reply/urgentFlags';

describe('detectBusinessActionFlags', () => {
    it('flags an Arabic exchange request (eval #128 regression)', () => {
        expect(detectBusinessActionFlags('ابي ابدل الجوال بلون ثاني')).toContain('exchange_request');
    });

    it('flags Arabic cancellation / refund / exchange', () => {
        expect(detectBusinessActionFlags('ابي الغي طلبي رقم 5678')).toContain('cancellation_request');
        expect(detectBusinessActionFlags('ارجعوا فلوسي، المنتج ما يشتغل')).toContain('refund_request');
        expect(detectBusinessActionFlags('اسوأ خدمة! الغوا طلبي فوراً')).toContain('cancellation_request');
    });

    it('flags English cancellation / refund / exchange', () => {
        expect(detectBusinessActionFlags('I want to cancel my order #9012')).toContain('cancellation_request');
        expect(detectBusinessActionFlags('I need a full refund please, the item arrived damaged')).toContain('refund_request');
        expect(detectBusinessActionFlags('can I exchange this for a different size?')).toContain('exchange_request');
    });

    it('does NOT fire on a generic complaint (eval #131)', () => {
        expect(detectBusinessActionFlags('الخدمة بطيئة والتوصيل تأخر')).toEqual([]);
    });

    it('does NOT fire on a product availability question (eval #132)', () => {
        expect(detectBusinessActionFlags('هل عندكم ايفون 15 متوفر؟')).toEqual([]);
        expect(detectBusinessActionFlags('Is the iPhone 15 available?')).toEqual([]);
    });

    it('returns [] for empty/undefined input', () => {
        expect(detectBusinessActionFlags(undefined)).toEqual([]);
        expect(detectBusinessActionFlags('')).toEqual([]);
    });
});
