import { describe, it, expect } from 'vitest';
import { chunkKnowledgeBase, chunkBusinessProfile, chunkProducts } from '../../../src/services/kb/chunker';

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

        it('keeps structured KB sections together (does not fragment by blank lines)', () => {
            // Simulates the serialized format from the frontend KB editor
            const text = [
                '💰 المنتجات والخدمات:',
                'نحنا خدمة مخصص للردود الذكية للزبائن',
                '',
                '✦ الأسعار:',
                'خطط الاشتراك',
                '',
                '1️⃣ الباقة التجريبية',
                '',
                'السعر:',
                '9 دولار شهرياً',
                '',
                '2️⃣ باقة الأعمال',
                '',
                'السعر:',
                '29 دولار شهرياً',
            ].join('\n');

            const chunks = chunkKnowledgeBase(text);

            // Should produce 2 chunks (one per section), NOT 7+ fragments
            expect(chunks).toHaveLength(2);

            // The pricing chunk should contain ALL pricing info in one chunk
            const pricingChunk = chunks.find(c => c.contentOriginal.includes('9 دولار'));
            expect(pricingChunk).toBeDefined();
            expect(pricingChunk!.contentOriginal).toContain('29 دولار');
            expect(pricingChunk!.contentOriginal).toContain('الباقة التجريبية');
            expect(pricingChunk!.contentOriginal).toContain('باقة الأعمال');
        });

        it('detects offering type for Arabic pricing section with ال prefix', () => {
            const text = '✦ الأسعار:\nباقة 1: 9 دولار\nباقة 2: 29 دولار';
            const chunks = chunkKnowledgeBase(text);
            expect(chunks[0].type).toBe('offering');
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

        it('renders the hours chunk in Saturday-first week order, not insertion order', () => {
            const profile = {
                hours: {
                    mon: ['09:00-18:00'],
                    sat: ['10:00-14:00'],
                    fri: ['closed'],
                    sun: ['09:00-18:00'],
                },
            };
            const chunks = chunkBusinessProfile(profile);
            const content = chunks.find(c => c.type === 'hours')!.contentOriginal;
            const lines = content.split('\n');
            expect(lines[0]).toContain('السبت');
            expect(lines[1]).toContain('الأحد');
            expect(lines[2]).toContain('الإثنين');
            expect(lines[3]).toContain('الجمعة');
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

    describe('chunkProducts', () => {
        it('returns empty array for empty input', () => {
            expect(chunkProducts([])).toEqual([]);
        });

        it('filters out non-active products', () => {
            const chunks = chunkProducts([
                { platformProductId: '1', title: 'Active', status: 'active', totalInventory: 10, hasVariants: false },
                { platformProductId: '2', title: 'Draft', status: 'draft', totalInventory: 5, hasVariants: false },
                { platformProductId: '3', title: 'Archived', status: 'archived', totalInventory: 0, hasVariants: false },
            ]);
            expect(chunks).toHaveLength(1);
            expect(chunks[0].title).toBe('Active');
        });

        it('sets type to product for all chunks', () => {
            const chunks = chunkProducts([
                { platformProductId: '1', title: 'Test Product', status: 'active', totalInventory: 10, hasVariants: false },
            ]);
            expect(chunks[0].type).toBe('product');
        });

        it('includes all product fields in content', () => {
            const chunks = chunkProducts([{
                platformProductId: 'p1',
                title: 'iPhone 15 Pro',
                description: 'Latest flagship with A17 chip and titanium frame',
                productType: 'Smartphones',
                vendor: 'Apple',
                status: 'active',
                priceRange: '3,999 - 4,499',
                currency: 'SAR',
                totalInventory: 50,
                hasVariants: true,
                variantSummary: '128GB, 256GB in Black, White',
                tags: 'phone, apple',
            }]);
            const content = chunks[0].contentOriginal;
            expect(content).toContain('Product: iPhone 15 Pro (ID: p1)');
            expect(content).toContain('Latest flagship with A17 chip');
            expect(content).toContain('Category: Smartphones');
            expect(content).toContain('Vendor: Apple');
            expect(content).toContain('Price: 3,999 - 4,499 SAR');
            expect(content).toContain('Variants: 128GB, 256GB in Black, White');
            expect(content).toContain('Availability: in stock');
            expect(content).toContain('Tags: phone, apple');
        });

        it('includes product description when available', () => {
            const chunks = chunkProducts([{
                platformProductId: '1',
                title: 'Wireless Earbuds',
                description: 'Noise cancelling with 24h battery life',
                status: 'active',
                totalInventory: 20,
                hasVariants: false,
            }]);
            expect(chunks[0].contentOriginal).toContain('Noise cancelling with 24h battery life');
        });

        it('marks out-of-stock products', () => {
            const chunks = chunkProducts([
                { platformProductId: '1', title: 'Sold Out', status: 'active', totalInventory: 0, hasVariants: false },
            ]);
            expect(chunks[0].contentOriginal).toContain('Availability: out of stock');
        });

        it('marks low-stock products (inventory <= 5)', () => {
            const chunks = chunkProducts([
                { platformProductId: '1', title: 'Almost Gone', status: 'active', totalInventory: 3, hasVariants: false },
            ]);
            expect(chunks[0].contentOriginal).toContain('Availability: low stock');
        });

        it('marks in-stock products (inventory > 5)', () => {
            const chunks = chunkProducts([
                { platformProductId: '1', title: 'Available', status: 'active', totalInventory: 100, hasVariants: false },
            ]);
            expect(chunks[0].contentOriginal).toContain('Availability: in stock');
        });

        // F1: a null inventory means untracked/unlimited (Zid `is_infinite`), not zero.
        // `null <= 5` is true in JS, so the pre-fix chain wrote unlimited stock into the
        // KB as "low stock" — the AI then told customers a flagship product was running out.
        it('marks unlimited (null inventory) products as in stock, never low stock', () => {
            const chunks = chunkProducts([
                { platformProductId: '1', title: 'Unlimited', status: 'active', totalInventory: null, hasVariants: false },
            ]);
            expect(chunks[0].contentOriginal).toContain('Availability: in stock');
            expect(chunks[0].contentOriginal).not.toContain('low stock');
            expect(chunks[0].contentOriginal).not.toContain('out of stock');
        });

        it('normalizes Arabic product names and detects language', () => {
            const chunks = chunkProducts([
                { platformProductId: '1', title: 'عطر أصلي مع التوصيل', status: 'active', totalInventory: 10, hasVariants: false },
            ]);
            expect(chunks[0].language).toBe('ar');
            // Alef with hamza should be normalized
            expect(chunks[0].titleNormalized).not.toContain('أ');
        });

        it('stores platformProductId in metadata', () => {
            const chunks = chunkProducts([
                { platformProductId: 'shopify-123', title: 'Test', status: 'active', totalInventory: 10, hasVariants: false },
            ]);
            expect(chunks[0].metadata).toEqual({ source: 'ecommerce', platformProductId: 'shopify-123' });
        });

        it('handles product with minimal fields (no optional data)', () => {
            const chunks = chunkProducts([
                { platformProductId: '1', title: 'Simple Product', status: 'active', totalInventory: 100, hasVariants: false },
            ]);
            expect(chunks[0].contentOriginal).toContain('Product: Simple Product');
            expect(chunks[0].contentOriginal).toContain('Availability: in stock');
            expect(chunks[0].contentOriginal).not.toContain('Category:');
            expect(chunks[0].contentOriginal).not.toContain('Vendor:');
            expect(chunks[0].contentOriginal).not.toContain('Variants:');
            expect(chunks[0].contentOriginal).not.toContain('Tags:');
        });

        it('splits products with very long descriptions into multiple chunks', () => {
            const longDesc = 'Feature details. '.repeat(500); // ~8500 chars, well over 800 tokens
            const chunks = chunkProducts([{
                platformProductId: 'big-1',
                title: 'Product With Long Description',
                description: longDesc,
                status: 'active',
                totalInventory: 10,
                hasVariants: false,
            }]);
            expect(chunks.length).toBeGreaterThan(1);
            // All chunks should keep type and metadata
            for (const chunk of chunks) {
                expect(chunk.type).toBe('product');
                expect(chunk.metadata).toEqual({ source: 'ecommerce', platformProductId: 'big-1' });
            }
            // Split chunks get numbered titles
            expect(chunks[0].title).toContain('1/');
        });
    });
});
