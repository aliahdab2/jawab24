import { describe, it, expect } from 'vitest';
import {
    classifyFallbackIntent,
    detectAngryCustomer,
    classifyFallback,
} from '../../src/services/reply/fallbackClassifier';

describe('classifyFallbackIntent', () => {
    describe('Spam / Irrelevant', () => {
        it('should detect emoji-only messages', () => {
            expect(classifyFallbackIntent('😂😂😂')).toBe('SPAM_OR_IRRELEVANT');
        });

        it('should detect single punctuation', () => {
            expect(classifyFallbackIntent('.')).toBe('SPAM_OR_IRRELEVANT');
            expect(classifyFallbackIntent('...')).toBe('SPAM_OR_IRRELEVANT');
            expect(classifyFallbackIntent('?')).toBe('SPAM_OR_IRRELEVANT');
        });

        it('should detect spam keywords', () => {
            expect(classifyFallbackIntent('follow me @user')).toBe('SPAM_OR_IRRELEVANT');
            expect(classifyFallbackIntent('check my profile')).toBe('SPAM_OR_IRRELEVANT');
            expect(classifyFallbackIntent('منشن صديقك 😂')).toBe('SPAM_OR_IRRELEVANT');
        });

        it('should detect @mention + spam keyword', () => {
            expect(classifyFallbackIntent('@friend check this out')).toBe('SPAM_OR_IRRELEVANT');
        });

        it('should detect non-compliment emoji spam', () => {
            expect(classifyFallbackIntent('😂😂😂')).toBe('SPAM_OR_IRRELEVANT');
        });
    });

    describe('Compliment', () => {
        it('should detect Arabic compliments', () => {
            expect(classifyFallbackIntent('ممتازين والله')).toBe('COMPLIMENT');
            expect(classifyFallbackIntent('خدمة رائعة')).toBe('COMPLIMENT');
            expect(classifyFallbackIntent('ماشاء الله')).toBe('COMPLIMENT');
        });

        it('should detect English compliments', () => {
            expect(classifyFallbackIntent('great service!')).toBe('COMPLIMENT');
            expect(classifyFallbackIntent('amazing work')).toBe('COMPLIMENT');
            expect(classifyFallbackIntent('thanks')).toBe('COMPLIMENT');
        });

        it('should detect positive emoji reactions', () => {
            expect(classifyFallbackIntent('❤️')).toBe('COMPLIMENT');
            expect(classifyFallbackIntent('👍')).toBe('COMPLIMENT');
            expect(classifyFallbackIntent('👏👏')).toBe('COMPLIMENT');
        });
    });

    describe('Purchase Intent', () => {
        it('should detect Arabic purchase intent', () => {
            expect(classifyFallbackIntent('ابي اشتري لابتوب')).toBe('PURCHASE_INTENT');
        });

        it('should detect English purchase intent', () => {
            expect(classifyFallbackIntent('I want to buy this')).toBe('PURCHASE_INTENT');
        });
    });

    describe('Business Inquiry', () => {
        it('should detect Arabic business inquiry', () => {
            expect(classifyFallbackIntent('نبي نتعاون معكم كمؤثرين')).toBe('BUSINESS_INQUIRY');
        });

        it('should detect English business inquiry', () => {
            expect(classifyFallbackIntent('interested in a partnership')).toBe('BUSINESS_INQUIRY');
        });
    });

    describe('Delegates to detectIntent for standard categories', () => {
        it('should detect greetings', () => {
            expect(classifyFallbackIntent('مرحبا')).toBe('GREETING');
            expect(classifyFallbackIntent('hello')).toBe('GREETING');
        });

        it('should detect price questions → QUESTION', () => {
            expect(classifyFallbackIntent('كم السعر؟')).toBe('QUESTION');
            expect(classifyFallbackIntent('how much?')).toBe('QUESTION');
        });

        it('should detect location questions → QUESTION', () => {
            expect(classifyFallbackIntent('وين موقعكم؟')).toBe('QUESTION');
        });

        it('should detect complaints', () => {
            expect(classifyFallbackIntent('خدمتكم سيئة')).toBe('COMPLAINT');
        });

        it('should return undefined for unclassifiable text', () => {
            expect(classifyFallbackIntent('interesting perspective')).toBeUndefined();
        });
    });
});

describe('detectAngryCustomer', () => {
    it('should detect Arabic anger expressions', () => {
        expect(detectAngryCustomer('اسوأ خدمة بحياتي! ابي ارجع فلوسي فوراً')).toBe(true);
        expect(detectAngryCustomer('بشتكي عليكم')).toBe(true);
        expect(detectAngryCustomer('ليش ما ترد')).toBe(true);
    });

    it('should detect English anger expressions', () => {
        expect(detectAngryCustomer('I\'ve been waiting 3 days and no response!')).toBe(true);
        expect(detectAngryCustomer('worst service ever')).toBe(true);
        expect(detectAngryCustomer('I want my money back now!')).toBe(true);
    });

    it('should NOT flag normal messages', () => {
        expect(detectAngryCustomer('كم السعر؟')).toBe(false);
        expect(detectAngryCustomer('hello')).toBe(false);
        expect(detectAngryCustomer('شكرا')).toBe(false);
    });
});

describe('classifyFallback', () => {
    it('should return intent + low confidence for a question', () => {
        const result = classifyFallback('كم السعر؟');
        expect(result.intent).toBe('QUESTION');
        expect(result.confidence).toBe('low');
        expect(result.flags).toEqual([]);
    });

    it('should add angry_customer flag for frustrated messages', () => {
        const result = classifyFallback('اسوأ خدمة بحياتي! ابي ارجع فلوسي فوراً');
        expect(result.intent).toBe('COMPLAINT');
        expect(result.confidence).toBe('low');
        expect(result.flags).toContain('angry_customer');
    });

    it('should return undefined intent for unclassifiable text', () => {
        const result = classifyFallback('lorem ipsum dolor sit amet');
        expect(result.intent).toBeUndefined();
        expect(result.confidence).toBe('low');
        expect(result.flags).toEqual([]);
    });

    it('should classify spam correctly', () => {
        const result = classifyFallback('🔥🔥 follow me @influencer');
        expect(result.intent).toBe('SPAM_OR_IRRELEVANT');
        expect(result.confidence).toBe('low');
    });
});
