import { describe, it, expect } from 'vitest';
import { detectIntent, type PreGptIntent } from '../../../src/services/kb/intent-detector';

describe('IntentDetector - detectIntent', () => {
    describe('GREETING', () => {
        it.each([
            'Hi',
            'hello',
            'Hey there',
            'Good morning!',
            'مرحبا',
            'هلا',
            'السلام عليكم',
            'صباح الخير',
            'مساء الخير',
            'اهلا',
            'كيفك',
        ])('detects "%s" as GREETING', (text) => {
            expect(detectIntent(text)).toBe('GREETING');
        });
    });

    describe('PRICE', () => {
        it.each([
            'How much is this?',
            'What is the price?',
            'pricing details',
            'What does it cost?',
            'بكم الباقة؟',
            'كم سعر الورد؟',
            'شو السعر؟',
            'قديش الثمن؟',
            'بكام ده؟',
            'اسعار المنتجات',
        ])('detects "%s" as PRICE', (text) => {
            expect(detectIntent(text)).toBe('PRICE');
        });
    });

    describe('HOURS', () => {
        it.each([
            'What are your hours?',
            'When do you open?',
            'What time do you close?',
            'opening hours',
            'working hours',
            'ساعات الدوام',
            'مواعيد العمل',
            'متى بتفتح؟',
        ])('detects "%s" as HOURS', (text) => {
            expect(detectIntent(text)).toBe('HOURS');
        });
    });

    describe('LOCATION', () => {
        it.each([
            'Where are you located?',
            'What is your address?',
            'any branches?',
            'وين المحل؟',
            'فين العنوان؟',
            'موقعكم وين؟',
        ])('detects "%s" as LOCATION', (text) => {
            expect(detectIntent(text)).toBe('LOCATION');
        });
    });

    describe('BOOKING', () => {
        it.each([
            'I want to book',
            'Can I make a reservation?',
            'I need an appointment',
            'بدي احجز',
            'عايز احجز موعد',
        ])('detects "%s" as BOOKING', (text) => {
            expect(detectIntent(text)).toBe('BOOKING');
        });
    });

    describe('POLICY', () => {
        it.each([
            'What is your return policy?',
            'Do you offer refunds?',
            'How is shipping handled?',
            'delivery options',
            'ارجاع المنتجات',
            'سياسة الاستبدال',
            'كيف التوصيل؟',
        ])('detects "%s" as POLICY', (text) => {
            expect(detectIntent(text)).toBe('POLICY');
        });
    });

    describe('COMPLAINT', () => {
        it.each([
            'This is terrible service',
            'I want to file a complaint',
            'Worst experience ever',
            'شكوى',
            'خدمة سيئ',
        ])('detects "%s" as COMPLAINT', (text) => {
            expect(detectIntent(text)).toBe('COMPLAINT');
        });
    });

    describe('OFFERING_INFO', () => {
        it.each([
            'Do you have red roses?',
            'Is it available?',
            'What do you sell?',
            'Can you show me the menu?',
            'عندكم ورد احمر؟',
            'موجود؟',
            'المنتجات المتوفرة',
        ])('detects "%s" as OFFERING_INFO', (text) => {
            expect(detectIntent(text)).toBe('OFFERING_INFO');
        });
    });

    describe('OTHER', () => {
        it.each([
            'Thanks for the info',
            'I will think about it',
            'OK',
            'شكرا',
            'بفكر فيها',
            '👍',
        ])('detects "%s" as OTHER', (text) => {
            expect(detectIntent(text)).toBe('OTHER');
        });
    });

    it('handles empty string as OTHER', () => {
        expect(detectIntent('')).toBe('OTHER');
    });

    it('handles Arabic with diacritics', () => {
        // "مَرحَبا" with diacritics should still match GREETING after normalization
        expect(detectIntent('مَرحَبا')).toBe('GREETING');
    });
});
