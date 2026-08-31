/**
 * Regression cover for the unmount leak in useVersion.
 *
 * Symptom (2026-09-01, frontend suite): every one of 3190 tests passed and the
 * run still exited non-zero on a single unhandled rejection —
 * `ReferenceError: window is not defined` thrown from React's scheduler via
 * `useVersion`'s `setLoading(false)`, surfacing from
 * test/pages/contentDates.test.tsx. The hook fetched /version and wrote state
 * whenever the promise settled; if that happened after the JSDOM environment
 * was torn down, React reached for a `window` that no longer existed. The leak
 * was real outside tests too — navigating away during a slow /version left the
 * hook writing state for a component nobody was looking at.
 *
 * ⚠️ Only the abort half is pinned below, and that is deliberate.
 * The fix has two halves: `controller.abort()` and the `cancelled` flag. A
 * mutation check showed that removing `cancelled` alone breaks NO test — React
 * discards state updates on an unmounted component silently and in-process, so
 * nothing observable changes. The condition that made it fatal (the whole test
 * environment being torn down mid-flight) is emergent across test FILES and
 * cannot be reproduced from inside one. Rather than ship an assertion that
 * cannot fail, the `cancelled` guard is justified by the production failure
 * above and documented in the hook. Do not "strengthen" these tests by adding
 * one that passes either way.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVersion } from '../useVersion';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useVersion — unmount safety', () => {
    it('aborts the in-flight request when the component unmounts', () => {
        let seenSignal: AbortSignal | undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn((_url: string, init?: RequestInit) => {
                seenSignal = init?.signal ?? undefined;
                // Never settles on its own — only the abort can end it.
                return new Promise(() => {});
            }),
        );

        const { unmount } = renderHook(() => useVersion());

        // The request must carry a signal at all, or the abort has nothing to act on.
        expect(seenSignal).toBeDefined();
        expect(seenSignal!.aborted).toBe(false);

        unmount();

        expect(seenSignal!.aborted).toBe(true);
    });

    it('reports the version when the request completes normally', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    version: 'deadbee',
                    shortVersion: 'deadbee',
                    deployedAt: '2026-09-01T00:00:00Z',
                    environment: 'production',
                }),
            })),
        );

        const { result } = renderHook(() => useVersion());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.versionInfo?.shortVersion).toBe('deadbee');
        expect(result.current.environment).toBe('production');
    });

    it('falls back cleanly when /version is unreachable', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('network down');
        }));

        const { result } = renderHook(() => useVersion());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.versionInfo).toBeNull();
        expect(result.current.environment).toBe('unknown');
    });
});
