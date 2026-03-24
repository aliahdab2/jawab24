import { captureError } from '@/lib/sentryHelpers';

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

        // Get API URL from environment (required for mobile where origin is localhost)
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';
        
        // Race between fetch and timeout
        const response = await Promise.race([
            fetch(`${apiUrl}/geo/check`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
            }),
            timeout(timeoutMs),
        ]);

        if (!response.ok) {
            // Display mode: permissive (don't block UI)
            captureError(new Error(`Geo check HTTP ${response.status}`), 'Geo check failed (display mode)', { tags: { context: 'geo-display' }, level: 'warning' });
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
            captureError(error, 'Geo check timed out (display mode)', { tags: { context: 'geo-display' }, level: 'warning' });
        } else {
            captureError(error, 'Geo check error (display mode)', { tags: { context: 'geo-display' }, level: 'warning' });
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
 * Check if user is sanctioned for payment flows.
 *
 * Strategy:
 * 1. Try fresh API call — if it succeeds, trust the result and update cache
 * 2. If API fails, fall back to cached result from the page-load check
 * 3. Only block if both API and cache are unavailable (truly unknown user)
 *
 * @returns Promise<boolean> - true if sanctioned or completely unknown
 */
export async function isUserSanctioned(): Promise<boolean> {
    try {
        // DEV OVERRIDE
        if (typeof window !== 'undefined' && window.localStorage.getItem('SIMULATE_SANCTIONS') === 'true') {
            console.warn('Simulating Sanctions Mode Active');
            return true;
        }

        // Get API URL from environment (required for mobile where origin is localhost)
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

        const response = await fetch(`${apiUrl}/geo/check`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            captureError(new Error(`Geo check HTTP ${response.status}`), 'Geo check failed (payment mode)', { tags: { context: 'geo-payment' }, level: 'warning' });
            // API error — fall back to cache from page-load check
            const cached = getCachedGeoCheck();
            if (cached) return cached.sanctioned;
            return true; // No cache, no API — block for safety
        }

        const data: GeoCheckResponse = await response.json();
        cacheGeoCheck(data.sanctioned, data.country);
        return data.sanctioned;
    } catch (error) {
        captureError(error, 'Geo check error (payment mode)', { tags: { context: 'payment' } });
        // Network error — fall back to cache from page-load check
        const cached = getCachedGeoCheck();
        if (cached) return cached.sanctioned;
        return true; // No cache, no API — block for safety
    }
}

/**
 * Get the user's country code (if available)
 * 
 * @returns Promise<string | undefined> - ISO country code or undefined
 */
export async function getUserCountry(): Promise<string | undefined> {
    try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';
        const response = await fetch(`${apiUrl}/geo/check`);
        if (!response.ok) return undefined;

        const data: GeoCheckResponse = await response.json();
        return data.country;
    } catch {
        return undefined;
    }
}
