/**
 * Typed access to the Capacitor global.
 * Eliminates (window as any).Capacitor casts across the codebase.
 */

interface CapacitorGlobal {
    isNativePlatform(): boolean;
    getPlatform(): 'ios' | 'android' | 'web';
}

/**
 * Get the Capacitor global if available (returns null on web/SSR).
 */
export function getCapacitor(): CapacitorGlobal | null {
    if (typeof window === 'undefined') return null;
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    return cap ?? null;
}

/**
 * Check if running in a native Capacitor environment (iOS/Android).
 */
export function isNativePlatform(): boolean {
    return getCapacitor()?.isNativePlatform?.() ?? false;
}
