/**
 * Geo Check Utility for Frontend
 * 
 * Checks if the current user is in a sanctioned jurisdiction
 * by calling the backend geo check endpoint.
 * 
 * IMPORTANT SECURITY MODEL:
 * - Display mode: Permissive (don't block UI if check fails)
 * - Payment mode: Strict (block payments if check fails or unknown)
 */

export interface GeoCheckResponse {
    sanctioned: boolean;
    country?: string;
}

export interface GeoCheckResult {
    sanctioned: boolean;
    country?: string;
    cached: boolean;
    timedOut: boolean;
}

const GEO_CACHE_KEY = 'jawab24_geo_check';
const GEO_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CachedGeoData {
    sanctioned: boolean;
    country?: string;
    timestamp: number;
}

/**
 * Create a promise that rejects after a timeout
 */
function timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), ms)
    );
}

/**
 * Get cached geo check result if available and not expired
 */
function getCachedGeoCheck(): GeoCheckResult | null {
    if (typeof window === 'undefined') return null;

    try {
        const cached = localStorage.getItem(GEO_CACHE_KEY);
        if (!cached) return null;

        const data: CachedGeoData = JSON.parse(cached);
        const age = Date.now() - data.timestamp;

        if (age > GEO_CACHE_TTL) {
            localStorage.removeItem(GEO_CACHE_KEY);
            return null;
        }

        return {
            sanctioned: data.sanctioned,
            country: data.country,
            cached: true,
            timedOut: false,
        };
    } catch {
        return null;
    }
}

/**
 * Cache geo check result
 */
function cacheGeoCheck(sanctioned: boolean, country?: string): void {
    if (typeof window === 'undefined') return;

    try {
        const data: CachedGeoData = {
            sanctioned,
            country,
            timestamp: Date.now(),
        };
        localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(data));
    } catch {
        // Ignore cache errors
    }
}

/**
 * Check if the current user's geo is sanctioned (with timeout and caching)
 * 
 * DISPLAY MODE (permissive):
 * - Returns false (not sanctioned) if check fails or times out
 * - This allows pricing page to display normally
 * 
 * PAYMENT MODE (strict):
 * - Use isUserSanctionedForPayment() instead
 * - Blocks payments if check fails or is unknown
 * 
 * @param timeoutMs - Maximum time to wait for check (default: 2000ms)
 * @returns Promise<GeoCheckResult>
 */
export async function isUserSanctionedNonBlocking(timeoutMs: number = 2000): Promise<GeoCheckResult> {
    // Check cache first
    const cached = getCachedGeoCheck();
    if (cached) {
        return cached;
    }

    try {
        // DEV OVERRIDE: Allow simulating sanctions via localStorage
        if (typeof window !== 'undefined' && window.localStorage.getItem('SIMULATE_SANCTIONS') === 'true') {
            console.warn('Simulating Sanctions Mode Active');
            const result = { sanctioned: true, cached: false, timedOut: false };
            cacheGeoCheck(true);
            return result;
        }

        // Race between fetch and timeout
        const response = await Promise.race([
            fetch('/api/geo/check', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
            }),
            timeout(timeoutMs),
        ]);

        if (!response.ok) {
            // Display mode: permissive (don't block UI)
            console.warn('Geo check failed, assuming not sanctioned for display');
            return { sanctioned: false, cached: false, timedOut: false };
        }

        const data: GeoCheckResponse = await response.json();

        // Cache the result
        cacheGeoCheck(data.sanctioned, data.country);

        return {
            sanctioned: data.sanctioned,
            country: data.country,
            cached: false,
            timedOut: false,
        };
    } catch (error) {
        // Timeout or network error
        const isTimeout = error instanceof Error && error.message === 'Timeout';

        if (isTimeout) {
            console.warn('Geo check timed out, assuming not sanctioned for display');
        } else {
            console.warn('Geo check error, assuming not sanctioned for display:', error);
        }

        // Display mode: permissive (don't block UI)
        return {
            sanctioned: false,
            cached: false,
            timedOut: isTimeout,
        };
    }
}

/**
 * LEGACY: Check if user is sanctioned (safe-by-default for payments)
 * 
 * ⚠️ PAYMENT MODE: Blocks if check fails
 * Use this for payment/checkout flows only
 * 
 * @returns Promise<boolean> - true if sanctioned OR if check fails
 */
export async function isUserSanctioned(): Promise<boolean> {
    try {
        // DEV OVERRIDE
        if (typeof window !== 'undefined' && window.localStorage.getItem('SIMULATE_SANCTIONS') === 'true') {
            console.warn('Simulating Sanctions Mode Active');
            return true;
        }

        const response = await fetch('/api/geo/check', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
        });

        if (!response.ok) {
            // Payment mode: strict (block if check fails)
            console.warn('Geo check failed, defaulting to blocked for payment');
            return true;
        }

        const data: GeoCheckResponse = await response.json();
        return data.sanctioned;
    } catch (error) {
        // Payment mode: strict (block if error)
        console.error('Geo check error, defaulting to blocked for payment:', error);
        return true;
    }
}

/**
 * Get the user's country code (if available)
 * 
 * @returns Promise<string | undefined> - ISO country code or undefined
 */
export async function getUserCountry(): Promise<string | undefined> {
    try {
        const response = await fetch('/api/geo/check');
        if (!response.ok) return undefined;

        const data: GeoCheckResponse = await response.json();
        return data.country;
    } catch {
        return undefined;
    }
}
