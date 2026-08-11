import { useState, useEffect, useCallback } from 'react';
import type { EcommerceStore } from '@jawab24/shared';

/**
 * Load a connected store, then auto-sync its catalogue — the opening move of
 * every e-commerce onboarding wizard.
 *
 * Extracted because Salla, Shopify and Zid each carried a byte-identical copy of
 * this effect plus its retry handler, differing only in which API object they
 * called (Rule 10.8). The three-way clone sat in the duplication baseline; this
 * removes it rather than re-baselining it.
 *
 * The store/sync state is owned entirely here: in all three pages these setters
 * were only ever touched by this effect and by the retry button, so nothing is
 * left behind in the components.
 */

export type StoreSyncStatus = 'idle' | 'syncing' | 'done' | 'error';

/** The slice of a platform's API client this hook needs. */
export interface EcommerceStoreSyncApi {
    getStore: () => Promise<EcommerceStore | null>;
    syncProducts: () => Promise<{ synced?: number }>;
}

export interface EcommerceStoreSyncState {
    store: EcommerceStore | null;
    storeLoading: boolean;
    storeError: boolean;
    syncStatus: StoreSyncStatus;
    syncResult: { synced?: number };
    /** Re-run the product sync only — the store itself is already loaded. */
    retrySync: () => Promise<void>;
}

/**
 * @param api      the platform client (module singleton — stable across renders)
 * @param enabled  gate the fetch; the wizards pass `isAuthenticated && step >= 1`
 */
export function useEcommerceStoreSync(
    api: EcommerceStoreSyncApi,
    enabled: boolean,
): EcommerceStoreSyncState {
    const [store, setStore] = useState<EcommerceStore | null>(null);
    const [storeLoading, setStoreLoading] = useState(true);
    const [storeError, setStoreError] = useState(false);
    const [syncStatus, setSyncStatus] = useState<StoreSyncStatus>('idle');
    const [syncResult, setSyncResult] = useState<{ synced?: number }>({});

    // A sync failure is NOT a store failure: the store is connected and the
    // wizard continues, it just reports the catalogue didn't land. Keeping that
    // distinction is why the inner try/catch is separate from the outer one.
    const retrySync = useCallback(async () => {
        setSyncStatus('syncing');
        try {
            setSyncResult(await api.syncProducts());
            setSyncStatus('done');
        } catch {
            setSyncStatus('error');
        }
    }, [api]);

    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;
        void (async () => {
            try {
                const res = await api.getStore();
                if (cancelled) return;
                setStore(res);
                setStoreLoading(false);
                await retrySync();
            } catch {
                if (cancelled) return;
                setStoreError(true);
                setStoreLoading(false);
            }
        })();

        // The originals had no cancellation and could set state after unmount —
        // a merchant who clicks through the wizard fast enough hits it.
        return () => { cancelled = true; };
    }, [enabled, api, retrySync]);

    return { store, storeLoading, storeError, syncStatus, syncResult, retrySync };
}
