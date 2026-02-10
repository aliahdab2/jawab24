import { describe, it, expect } from 'vitest';
import { chunkKnowledgeBase, chunkBusinessProfile } from '../../../src/services/kb/chunker';

describe('ChunkerService', () => {

    describe('chunkKnowledgeBase', () => {
        it('returns empty array for empty/null input', () => {
            expect(chunkKnowledgeBase('')).toEqual([]);
            expect(chunkKnowledgeBase('   ')).toEqual([]);
        });

        it('creates a single chunk for short text', () => {
            const chunks = chunkKnowledgeBase('نحن مطعم بيتزا في دبي');
            expect(chunks).toHaveLength(1);
            expect(chunks[0].contentOriginal).toBe('نحن مطعم بيتزا في دبي');
            expect(chunks[0].type).toBe('info');
        });

        it('splits on double newlines into separate chunks', () => {
            const text = 'First section about our restaurant\n\nSecond section about delivery';
            const chunks = chunkKnowledgeBase(text);
            expect(chunks.length).toBeGreaterThanOrEqual(2);
        });

        it('detects chunk types from content', () => {
            const text = [
                'delivery policy\nWe deliver within Dubai for free on orders above 100 AED.',
                '',
                'return policy\nReturns accepted within 14 days with receipt.',
                '',
                'ساعات العمل\nالسبت - الخميس: 9 صباحاً - 10 مساءً',
            ].join('\n');

            const chunks = chunkKnowledgeBase(text);

            const deliveryChunk = chunks.find(c => c.contentOriginal.includes('deliver'));
            expect(deliveryChunk?.type).toBe('policy');

            const returnChunk = chunks.find(c => c.contentOriginal.includes('Returns'));
            expect(returnChunk?.type).toBe('policy');

            const hoursChunk = chunks.find(c => c.contentOriginal.includes('السبت'));
            expect(hoursChunk?.type).toBe('hours');
        });

        it('detects Arabic language in chunks', () => {
            const text = 'متجر متخصص في بيع الملابس العربية الأصيلة';
            const chunks = chunkKnowledgeBase(text);
            expect(chunks[0].language).toBe('ar');
        });

        it('detects English language in chunks', () => {
            const text = 'We are a premium flower shop based in Riyadh';
            const chunks = chunkKnowledgeBase(text);
            expect(chunks[0].language).toBe('en');
        });

        it('normalizes Arabic content', () => {
            const text = 'أحمد يحبّ البيتزا';
            const chunks = chunkKnowledgeBase(text);
            // Diacritics removed, alef normalized
            expect(chunks[0].contentNormalized).toBe('احمد يحب البيتزا');
        });

        it('estimates token count', () => {
            const text = 'This is a test sentence with some words in it.';
            const chunks = chunkKnowledgeBase(text);
            expect(chunks[0].tokenCount).toBeGreaterThan(0);
            // ~48 chars / 3.5 ≈ 14 tokens
            expect(chunks[0].tokenCount).toBeLessThan(20);
        });

        it('extracts title from first short line', () => {
            const text = 'Our Menu\nPizza Margherita: 45 AED\nPizza Pepperoni: 55 AED';
            const chunks = chunkKnowledgeBase(text);
            expect(chunks[0].title).toBe('Our Menu');
        });

        it('strips emoji/marker prefixes from titles', () => {
            const text = '🏷️ نوع النشاط: مطعم\nنحن مطعم متخصص في البيتزا الإيطالية';
            const chunks = chunkKnowledgeBase(text);
            expect(chunks[0].title).not.toMatch(/^🏷️/);
        });

        it('splits very long text into multiple chunks with overlap', () => {
            // Create a text that's ~3000 tokens (well over 800 limit)
            const longParagraph = 'This is a sentence about our business products and services. '.repeat(200);
            const chunks = chunkKnowledgeBase(longParagraph);
            expect(chunks.length).toBeGreaterThan(1);
            // Each chunk should be within token limits
            for (const chunk of chunks) {
                expect(chunk.tokenCount).toBeLessThanOrEqual(900); // some tolerance
            }
        });

        it('handles real-world Facebook KB format', () => {
            const fbKb = [
                '🏷️ نوع النشاط: Restaurant',
                '',
                'Best pizza in Dubai since 2010',
                '',
                '📍 العنوان: Dubai Marina, Building 5',
                '',
                '📞 الهاتف: 0501234567',
                '',
                '🌐 الموقع: https://pizza.ae',
                '',
                '⏰ ساعات العمل:',
                'الإثنين: 09:00 - 22:00',
                'الثلاثاء: 09:00 - 22:00',
            ].join('\n');

            const chunks = chunkKnowledgeBase(fbKb);
            expect(chunks.length).toBeGreaterThanOrEqual(3);

            // Should have detected various types
            const types = new Set(chunks.map(c => c.type));
            expect(types.size).toBeGreaterThan(1);
        });

        it('handles mixed Arabic/English content', () => {
            const text = 'محل Flowers ورد\n\nWe deliver fresh flowers across Riyadh\n\nنقدم أجمل الباقات';
            const chunks = chunkKnowledgeBase(text);
            expect(chunks.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('chunkBusinessProfile', () => {
        it('returns empty array for empty profile', () => {
            expect(chunkBusinessProfile({})).toEqual([]);
        });

        it('creates hours chunk from structured hours', () => {
            const profile = {
                hours: {
                    mon: ['09:00-18:00'],
                    tue: ['09:00-18:00'],
                    fri: ['09:00-12:00', '16:00-22:00'],
                },
            };
            const chunks = chunkBusinessProfile(profile);
            const hoursChunk = chunks.find(c => c.type === 'hours');
            expect(hoursChunk).toBeDefined();
            expect(hoursChunk!.contentOriginal).toContain('09:00-18:00');
            expect(hoursChunk!.contentOriginal).toContain('16:00-22:00');
        });

        it('creates location chunk from address', () => {
            const profile = {
                address: 'Dubai Marina',
                city: 'Dubai',
                country: 'AE',
            };
            const chunks = chunkBusinessProfile(profile);
            const locationChunk = chunks.find(c => c.type === 'location');
            expect(locationChunk).toBeDefined();
            expect(locationChunk!.contentOriginal).toContain('Dubai Marina');
            expect(locationChunk!.contentOriginal).toContain('Dubai');
        });

        it('creates contact chunk from phone + website', () => {
            const profile = {
                phone: '0501234567',
                website: 'https://example.com',
            };
            const chunks = chunkBusinessProfile(profile);
            const contactChunk = chunks.find(c => c.type === 'contact');
            expect(contactChunk).toBeDefined();
            expect(contactChunk!.contentOriginal).toContain('0501234567');
            expect(contactChunk!.contentOriginal).toContain('https://example.com');
        });

        it('creates about/info chunk from about text', () => {
            const profile = {
                name: 'Pizza House',
                about: 'Best pizza in Dubai since 2010',
            };
            const chunks = chunkBusinessProfile(profile);
            const infoChunk = chunks.find(c => c.type === 'info');
            expect(infoChunk).toBeDefined();
            expect(infoChunk!.title).toBe('Pizza House');
            expect(infoChunk!.contentOriginal).toBe('Best pizza in Dubai since 2010');
        });

        it('marks businessProfile chunks with metadata source', () => {
            const profile = {
                phone: '0501234567',
                about: 'A great restaurant',
            };
            const chunks = chunkBusinessProfile(profile);
            for (const chunk of chunks) {
                expect(chunk.metadata).toHaveProperty('source', 'businessProfile');
            }
        });

        it('handles full profile with all fields', () => {
            const profile = {
                name: 'Pizza House',
                about: 'Best pizza in Dubai',
                phone: '0501234567',
                website: 'https://pizza.ae',
                address: 'Dubai Marina',
                city: 'Dubai',
                country: 'AE',
                hours: { mon: ['09:00-22:00'] },
            };
            const chunks = chunkBusinessProfile(profile);
            const types = new Set(chunks.map(c => c.type));
            expect(types.has('hours')).toBe(true);
            expect(types.has('location')).toBe(true);
            expect(types.has('contact')).toBe(true);
            expect(types.has('info')).toBe(true);
        });
    });
});
