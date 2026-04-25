import { useEffect, useState } from 'react';
import { ecommerceApi, sallaApi, zidApi } from '@/lib/api';
import type { EcommerceStore } from '@jawab24/shared';

interface PlatformLoader {
    id: 'shopify' | 'salla' | 'zid';
    getStore: () => Promise<{ data?: EcommerceStore | null } | EcommerceStore | null>;
}

const PLATFORMS: ReadonlyArray<PlatformLoader> = [
    { id: 'shopify', getStore: () => ecommerceApi.getStore() },
    { id: 'salla', getStore: () => sallaApi.getStore() },
    { id: 'zid', getStore: () => zidApi.getStore() },
];

function pickStore(raw: { data?: EcommerceStore | null } | EcommerceStore | null): EcommerceStore | null {
    if (!raw) return null;
    if ('data' in raw) return (raw.data as EcommerceStore | null) ?? null;
    return raw as EcommerceStore;
}

export interface UseConnectedStoreResult {
    store: EcommerceStore | null;
    loading: boolean;
}

/**
 * Returns the workspace's first active connected e-commerce store, or null.
 * Used by the analytics page + summary widget to figure out which store to query.
 *
 * v1 chooses the first active store — when multi-store is supported, this hook
 * (and only this hook) needs to learn store-selection state.
 */
export function useConnectedStore(enabled: boolean = true): UseConnectedStoreResult {
    const [store, setStore] = useState<EcommerceStore | null>(null);
    const [loading, setLoading] = useState(enabled);

    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            const results = await Promise.all(
                PLATFORMS.map(async (p) => {
                    try {
                        return pickStore(await p.getStore());
                    } catch {
                        return null;
                    }
                }),
            );
            if (cancelled) return;
            const firstActive = results.find((s) => s && s.isActive) ?? null;
            setStore(firstActive);
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [enabled]);

    return { store, loading };
}
