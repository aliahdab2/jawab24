import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
    trimInfinitePagesToFirst,
    invalidateInfiniteListFresh,
    createDebouncedInvalidator,
} from '../queryInvalidation';

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

describe('createDebouncedInvalidator', () => {
    const DEBOUNCE = 400;
    const MAX_WAIT = 2000;
    let qc: QueryClient;
    let invalidateSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        qc = new QueryClient();
        invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires once after the debounce window when called once', () => {
        const inv = createDebouncedInvalidator(qc, DEBOUNCE, MAX_WAIT);
        inv.invalidate(['messages-stats']);

        // Just before window: no fire
        vi.advanceTimersByTime(DEBOUNCE - 1);
        expect(invalidateSpy).not.toHaveBeenCalled();

        // At/past window: fires
        vi.advanceTimersByTime(1);
        expect(invalidateSpy).toHaveBeenCalledTimes(1);
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages-stats'] });
    });

    it('coalesces a burst into a single fire (debounce reset)', () => {
        const inv = createDebouncedInvalidator(qc, DEBOUNCE, MAX_WAIT);

        // Five events within the debounce window
        for (let i = 0; i < 5; i++) {
            inv.invalidate(['messages']);
            vi.advanceTimersByTime(100); // 5 × 100ms = 500ms total, each within debounce reset
        }
        // We're now 500ms in but the last reset was at 400ms in, so the timer
        // is still pending. Advance to debounce after the last call.
        vi.advanceTimersByTime(DEBOUNCE);

        expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });

    it('fires at max-wait when events keep arriving past the cap', () => {
        const inv = createDebouncedInvalidator(qc, DEBOUNCE, MAX_WAIT);

        // Sustained burst: an event every 100ms forever resets the trailing
        // timer, but max-wait should fire after MAX_WAIT regardless.
        for (let t = 0; t < MAX_WAIT + 500; t += 100) {
            inv.invalidate(['messages']);
            vi.advanceTimersByTime(100);
        }
        // Once max-wait fires it clears both timers and deletes the entry, so
        // a subsequent invalidate would start a fresh cycle. Within the first
        // max-wait window we expect exactly one fire.
        expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });

    it('debounces independently per queryKey', () => {
        const inv = createDebouncedInvalidator(qc, DEBOUNCE, MAX_WAIT);

        inv.invalidate(['messages']);
        inv.invalidate(['comments-stats']);

        vi.advanceTimersByTime(DEBOUNCE);
        expect(invalidateSpy).toHaveBeenCalledTimes(2);
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['comments-stats'] });
    });

    it('honors trimInfinite when any caller in the burst opts in', () => {
        qc.setQueryData(['messages', { pageId: 'p1' }], {
            pages: ['p0', 'p1', 'p2'],
            pageParams: [undefined, 'c1', 'c2'],
        });
        const inv = createDebouncedInvalidator(qc, DEBOUNCE, MAX_WAIT);

        // First call doesn't opt in; second does. The fire should still trim.
        inv.invalidate(['messages']);
        inv.invalidate(['messages'], { trimInfinite: true });
        vi.advanceTimersByTime(DEBOUNCE);

        const data = qc.getQueryData<{ pages: string[] }>(['messages', { pageId: 'p1' }]);
        expect(data?.pages).toEqual(['p0']);
        expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });

    it('flush() cancels pending invalidations without firing', () => {
        const inv = createDebouncedInvalidator(qc, DEBOUNCE, MAX_WAIT);

        inv.invalidate(['messages']);
        inv.invalidate(['comments-stats']);
        inv.flush();

        // Advance past both debounce and max-wait
        vi.advanceTimersByTime(MAX_WAIT + 100);
        expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('after a fire, a new invalidate on the same key starts a fresh cycle', () => {
        const inv = createDebouncedInvalidator(qc, DEBOUNCE, MAX_WAIT);

        inv.invalidate(['messages']);
        vi.advanceTimersByTime(DEBOUNCE);
        expect(invalidateSpy).toHaveBeenCalledTimes(1);

        // Second cycle
        inv.invalidate(['messages']);
        vi.advanceTimersByTime(DEBOUNCE);
        expect(invalidateSpy).toHaveBeenCalledTimes(2);
    });
});
