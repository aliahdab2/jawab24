import { describe, it, expect } from 'vitest';
import {
    classifyCommentShape,
    matchesInvitedSymbol,
    decideContentFreeGate,
    type ContentCtaClassification,
} from '../../../src/services/reply/commentCta';

const cta = (symbol: ContentCtaClassification['symbol'], word: string | null = null, confidence = 1): ContentCtaClassification =>
    ({ symbol, word, confidence });

describe('classifyCommentShape', () => {
    it.each([
        ['.', 'dot'], ['....', 'dot'], ['…', 'dot'], ['، ،', 'dot'], ['. . .', 'dot'],
        ['000', 'digits'], ['٠٠٠', 'digits'], ['1', 'digits'], ['١', 'digits'], ['0.0', 'digits'],
        ['1️⃣', 'digits'],                 // keycap digit: VS16 + U+20E3 stripped
        ['❤️', 'heart'], ['❤️❤️', 'heart'], ['🧡💛', 'heart'], ['♥', 'heart'], ['🩷', 'heart'],
        ['💞', 'heart'], ['💟', 'heart'], ['💕💖', 'heart'],
        ['🔥', 'emoji'], ['😍😍', 'emoji'], ['😡', 'emoji'], ['👍', 'emoji'], ['?', 'emoji'], ['!!!', 'emoji'],
        ['❤️🔥', 'emoji'],           // a heart plus something else is not a heart run
        ['تم', 'text'], ['كم السعر؟', 'text'], ['السعر؟ ❤️', 'text'], ['غالي 😡', 'text'], ['ICDL', 'text'],
        ['', 'text'], ['   ', 'text'],
    ] as const)('%j → %s', (input, expected) => {
        expect(classifyCommentShape(input)).toBe(expected);
    });
});

describe('matchesInvitedSymbol', () => {
    describe('dot CTA («علّق بنقطة»)', () => {
        it('accepts dot runs of any length', () => {
            expect(matchesInvitedSymbol('dot', 'dot')).toBe(true);
        });
        it('accepts digit runs — customers type «٠٠٠» on «نقطة» posts (eval #324)', () => {
            expect(matchesInvitedSymbol('digits', 'dot')).toBe(true);
        });
        it('rejects a heart or any other emoji — the merchant asked for a dot', () => {
            expect(matchesInvitedSymbol('heart', 'dot')).toBe(false);
            expect(matchesInvitedSymbol('emoji', 'dot')).toBe(false);
        });
    });

    it('digits CTA accepts dots too (one dot-like class, symmetric)', () => {
        expect(matchesInvitedSymbol('dot', 'digits')).toBe(true);
        expect(matchesInvitedSymbol('digits', 'digits')).toBe(true);
        expect(matchesInvitedSymbol('heart', 'digits')).toBe(false);
    });

    it('heart CTA accepts hearts only', () => {
        expect(matchesInvitedSymbol('heart', 'heart')).toBe(true);
        expect(matchesInvitedSymbol('emoji', 'heart')).toBe(false);
        expect(matchesInvitedSymbol('dot', 'heart')).toBe(false);
    });

    it('word CTA («اكتب تم») never matches a symbol — a dot there is skipped (owner ruling)', () => {
        for (const shape of ['dot', 'digits', 'heart', 'emoji'] as const) {
            expect(matchesInvitedSymbol(shape, 'word')).toBe(false);
        }
    });

    it('any CTA accepts every content-free shape', () => {
        for (const shape of ['dot', 'digits', 'heart', 'emoji'] as const) {
            expect(matchesInvitedSymbol(shape, 'any')).toBe(true);
        }
    });

    it('none / uncertain never match, and text never matches anything', () => {
        for (const symbol of ['none', 'uncertain'] as const) {
            expect(matchesInvitedSymbol('dot', symbol)).toBe(false);
            expect(matchesInvitedSymbol('heart', symbol)).toBe(false);
        }
        expect(matchesInvitedSymbol('text', 'any')).toBe(false);
    });
});

describe('decideContentFreeGate', () => {
    const enforce = { confidenceThreshold: 0.7, mode: 'enforce' as const };
    const shadow = { confidenceThreshold: 0.7, mode: 'shadow' as const };

    it('passes text comments through untouched, whatever the post asked — including the literal word of a word CTA', () => {
        expect(decideContentFreeGate({ commentText: 'كم السعر؟', classification: cta('dot'), ...enforce })).toEqual({ action: 'pass' });
        expect(decideContentFreeGate({ commentText: 'السعر؟ ❤️', classification: cta('none'), ...enforce })).toEqual({ action: 'pass' });
        expect(decideContentFreeGate({ commentText: 'غالي 😡', classification: null, ...enforce })).toEqual({ action: 'pass' });
        expect(decideContentFreeGate({ commentText: 'تم', classification: cta('word', 'تم'), ...enforce })).toEqual({ action: 'pass' });
    });

    it('proceeds on an invited symbol (dot on a dot post, in enforce and shadow alike)', () => {
        expect(decideContentFreeGate({ commentText: '....', classification: cta('dot'), ...enforce }))
            .toEqual({ action: 'proceed', symbol: 'dot', shape: 'dot' });
        expect(decideContentFreeGate({ commentText: '٠٠٠', classification: cta('dot'), ...shadow }))
            .toEqual({ action: 'proceed', symbol: 'dot', shape: 'digits' });
    });

    it('skips an uninvited symbol in enforce mode', () => {
        expect(decideContentFreeGate({ commentText: '.', classification: cta('none'), ...enforce }))
            .toEqual({ action: 'skip', symbol: 'none', shape: 'dot' });
        expect(decideContentFreeGate({ commentText: '❤️', classification: cta('dot'), ...enforce }))
            .toEqual({ action: 'skip', symbol: 'dot', shape: 'heart' });
        expect(decideContentFreeGate({ commentText: '.', classification: cta('word', 'تم'), ...enforce }).action).toBe('skip');
        expect(decideContentFreeGate({ commentText: '😡', classification: cta('none'), ...enforce }).action).toBe('skip');
    });

    it('only records a shadow skip in shadow mode — the caller must proceed as before', () => {
        expect(decideContentFreeGate({ commentText: '.', classification: cta('none'), ...shadow }))
            .toEqual({ action: 'shadow_skip', symbol: 'none', shape: 'dot' });
    });

    it('treats a missing classification (no caption / classifier down) as uncertain → skip', () => {
        expect(decideContentFreeGate({ commentText: '.', classification: null, ...enforce }))
            .toEqual({ action: 'skip', symbol: 'uncertain', shape: 'dot' });
    });

    it('treats a verdict under the confidence threshold as uncertain → skip; exactly at it → proceed', () => {
        expect(decideContentFreeGate({ commentText: '.', classification: cta('dot', null, 0.5), ...enforce }).action).toBe('skip');
        expect(decideContentFreeGate({ commentText: '.', classification: cta('dot', null, 0.7), ...enforce }).action).toBe('proceed');
    });

    it('a non-finite threshold never lets a verdict through (fails closed, never open)', () => {
        expect(decideContentFreeGate({ commentText: '.', classification: cta('dot', null, 1), confidenceThreshold: Number.NaN, mode: 'enforce' }).action).toBe('skip');
    });
});
