import { describe, it, expect } from 'vitest';
import { renderCatalogPromptBlock, type CatalogPromptItem } from '../../src/services/catalog';

const item = (overrides: Partial<CatalogPromptItem> = {}): CatalogPromptItem => ({
    type: 'product',
    name: 'دبل صدمات NJT',
    description: null,
    price: '3500.00',
    currency: 'EGP',
    isAvailable: true,
    ...overrides,
});

describe('renderCatalogPromptBlock', () => {
    it('returns undefined for an empty catalog (prompt stays byte-identical)', () => {
        expect(renderCatalogPromptBlock([])).toBeUndefined();
    });

    it('renders one line per item with plain-numeral price and stock vocabulary', () => {
        const block = renderCatalogPromptBlock([item()]);
        expect(block).toBe(
            'Items this business offers (merchant-entered):\n- دبل صدمات NJT — 3500 EGP — in stock',
        );
    });

    it('keeps decimal prices as-is and drops trailing zeros', () => {
        const block = renderCatalogPromptBlock([
            item({ name: 'A', price: '49.99' }),
            item({ name: 'B', price: '100.50' }),
        ])!;
        expect(block).toContain('- A — 49.99 EGP');
        expect(block).toContain('- B — 100.5 EGP');
    });

    it('renders "price on request" for null price and omits currency-only fragments', () => {
        const block = renderCatalogPromptBlock([item({ price: null, currency: null })])!;
        expect(block).toContain('— price on request — in stock');
    });

    it('renders price without currency when currency is missing', () => {
        const block = renderCatalogPromptBlock([item({ currency: null })])!;
        expect(block).toContain('— 3500 — in stock');
    });

    it('marks unavailable items as out of stock (e-commerce summary vocabulary)', () => {
        const block = renderCatalogPromptBlock([item({ isAvailable: false })])!;
        expect(block).toContain('— out of stock');
    });

    it('tags non-default types and leaves product/custom untagged', () => {
        const block = renderCatalogPromptBlock([
            item({ name: 'قطعة غيار', type: 'product' }),
            item({ name: 'دورة صيانة', type: 'course' }),
            item({ name: 'فحص دوري', type: 'service' }),
            item({ name: 'هوندا CG 2019', type: 'vehicle' }),
            item({ name: 'شيء آخر', type: 'custom' }),
        ])!;
        expect(block).toContain('- قطعة غيار —');
        expect(block).toContain('- [course] دورة صيانة —');
        expect(block).toContain('- [service] فحص دوري —');
        expect(block).toContain('- [vehicle] هوندا CG 2019 —');
        expect(block).toContain('- شيء آخر —');
    });

    it('appends the description clipped to 120 chars', () => {
        const longDesc = 'يناسب معظم الموتوسيكلات '.repeat(10); // > 120 chars
        const block = renderCatalogPromptBlock([item({ description: longDesc })])!;
        const line = block.split('\n')[1];
        expect(line).toContain('يناسب معظم');
        expect(line).toContain('…');
        // name + price + stock + clipped desc stays bounded
        expect(line.length).toBeLessThan(200);
    });

    it('drops descriptions before truncating when over budget', () => {
        // ~90 items with max-length descriptions: with descriptions >12k chars, without them well under
        const items = Array.from({ length: 90 }, (_, i) =>
            item({ name: `منتج رقم ${i}`, description: 'وصف طويل جدًا للمنتج يشرح كل التفاصيل والمواصفات المهمة '.repeat(3) }),
        );
        const block = renderCatalogPromptBlock(items)!;
        expect(block.length).toBeLessThanOrEqual(12000);
        // All items survived (no truncation tail) — only descriptions were sacrificed
        expect(block).toContain('منتج رقم 89');
        expect(block).not.toContain('NOT exhaustive');
        expect(block).not.toContain('وصف طويل');
    });

    it('truncates at an item boundary with an explicit non-exhaustive tail when even the bare list overflows', () => {
        const items = Array.from({ length: 300 }, (_, i) =>
            item({ name: `منتج بعنوان طويل نسبيًا حتى تكبر القائمة كثيرًا رقم ${i}` }),
        );
        const block = renderCatalogPromptBlock(items)!;
        expect(block.length).toBeLessThanOrEqual(12000);
        const tail = block.split('\n').at(-1)!;
        expect(tail).toMatch(/^\(\+\d+ more items not listed — this list is NOT exhaustive\)$/);
        // Tail count + kept lines must add up to the full catalog
        const keptCount = block.split('\n').length - 2; // minus header + tail
        const omitted = Number(tail.match(/\+(\d+)/)![1]);
        expect(keptCount + omitted).toBe(300);
        // No half-rendered item line before the tail
        const beforeTail = block.split('\n').at(-2)!;
        expect(beforeTail).toMatch(/ — (in|out of) stock$|price on request/);
    });
});
