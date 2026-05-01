import { useEffect, useState } from 'react';

/**
 * Boolean state persisted in localStorage. SSR-safe: hydration reads on the
 * client-side `useEffect`, so the initial server render uses `defaultValue`
 * and the client reconciles after mount. The brief flash from default →
 * persisted is acceptable for low-stakes UI toggles like collapsible
 * section state.
 */
export function usePersistedBoolean(
    key: string,
    defaultValue: boolean
): [boolean, (value: boolean) => void] {
    const [value, setValue] = useState(defaultValue);

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(key);
            if (stored !== null) {
                setValue(stored === '1');
            }
        } catch {
            // localStorage may be unavailable (private mode, quota exceeded) —
            // fall back to in-memory state.
        }
    }, [key]);

    const setPersisted = (next: boolean) => {
        setValue(next);
        try {
            window.localStorage.setItem(key, next ? '1' : '0');
        } catch {
            // ignore — see above
        }
    };

    return [value, setPersisted];
}
