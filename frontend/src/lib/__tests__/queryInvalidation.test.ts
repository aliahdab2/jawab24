import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { trimInfinitePagesToFirst, invalidateInfiniteListFresh } from '../queryInvalidation';

function seedInfinite<T>(qc: QueryClient, key: readonly unknown[], pages: T[], pageParams: unknown[]) {
    qc.setQueryData(key, { pages, pageParams });
}

describe('trimInfinitePagesToFirst', () => {
    it('drops pages 2+ and matching pageParams, keeps page 0', () => {
        const qc = new QueryClient();
        seedInfinite(qc, ['messages', { pageId: 'p1' }], ['page0', 'page1', 'page2'], [undefined, 'cursor-1', 'cursor-2']);

        trimInfinitePagesToFirst(qc, ['messages']);

        const data = qc.getQueryData<{ pages: string[]; pageParams: unknown[] }>(['messages', { pageId: 'p1' }]);
        expect(data?.pages).toEqual(['page0']);
        expect(data?.pageParams).toEqual([undefined]);
    });

    it('is a no-op when only one page is loaded', () => {
        const qc = new QueryClient();
        const original = { pages: ['page0'], pageParams: [undefined] };
        qc.setQueryData(['comments'], original);

        trimInfinitePagesToFirst(qc, ['comments']);

        // Reference equality — updater returned the same object
        expect(qc.getQueryData(['comments'])).toBe(original);
    });

    it('is a no-op for non-infinite cache shape (no pages array)', () => {
        const qc = new QueryClient();
        const original = { foo: 'bar' };
        qc.setQueryData(['some-other-key'], original);

        trimInfinitePagesToFirst(qc, ['some-other-key']);

        expect(qc.getQueryData(['some-other-key'])).toBe(original);
    });

    it('trims all matching prefix-keyed variants (filtered list views)', () => {
        const qc = new QueryClient();
        seedInfinite(qc, ['messages', { actionRequired: true, pageId: 'p1' }], ['a0', 'a1', 'a2'], [undefined, 'c1', 'c2']);
        seedInfinite(qc, ['messages', { actionRequired: false, pageId: 'p1' }], ['b0', 'b1'], [undefined, 'c1']);

        trimInfinitePagesToFirst(qc, ['messages']);

        expect(qc.getQueryData<{ pages: string[] }>(['messages', { actionRequired: true, pageId: 'p1' }])?.pages).toEqual(['a0']);
        expect(qc.getQueryData<{ pages: string[] }>(['messages', { actionRequired: false, pageId: 'p1' }])?.pages).toEqual(['b0']);
    });
});

describe('invalidateInfiniteListFresh', () => {
    it('trims pages then invalidates the queryKey', () => {
        const qc = new QueryClient();
        seedInfinite(qc, ['leads', 'pid-1'], ['p0', 'p1', 'p2'], [undefined, 'c1', 'c2']);
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

        invalidateInfiniteListFresh(qc, ['leads', 'pid-1']);

        // Trim happened
        expect(qc.getQueryData<{ pages: string[] }>(['leads', 'pid-1'])?.pages).toEqual(['p0']);
        // Invalidation called with the same key
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['leads', 'pid-1'] });
    });

    it('still invalidates when no cached data exists (cold cache)', () => {
        const qc = new QueryClient();
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

        invalidateInfiniteListFresh(qc, ['comments']);

        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['comments'] });
    });
});
