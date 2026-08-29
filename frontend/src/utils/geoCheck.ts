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

/** Exported so tests seed/inspect the real key instead of retyping the literal. */
export const GEO_CACHE_KEY = 'jawab24_geo_check';
const GEO_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CachedGeoData {
    sanctioned: boolean;
    country?: string;
    timestamp: number;
}

/**
 * DEV OVERRIDE: simulate a blocked jurisdiction from the browser console.
 *
 *   localStorage.setItem('SIMULATE_SANCTIONS', 'true')  → blocked, country unknown
 *   localStorage.setItem('SIMULATE_SANCTIONS', 'SY')    → blocked, resolved as Syria
 *
 * The country form exists because the region-specific copy (Sham Cash for
 * Syria) is invisible without one — a bare `true` reproduces the fail-closed
 * path where we block without ever resolving a country, which is a real state
 * but not the one you want when checking that copy.
 *
 * The simulated verdict is deliberately NEVER written to the geo cache. Doing
 * so leaves a real `sanctioned: true` entry behind that keeps blocking for the
 * full 24h TTL after the flag is removed, with nothing left on screen to
 * explain why. Every reader consults this function directly instead, so
 * clearing the flag ends the simulation immediately.
 */
function readSimulatedSanctions(): { active: boolean; country?: string } {
    if (typeof window === 'undefined') return { active: false };
    const raw = window.localStorage.getItem('SIMULATE_SANCTIONS');
    if (!raw) return { active: false };
    if (raw === 'true') return { active: true };
    // Anything else is only honoured as an ISO-3166 alpha-2 code, so a stray
    // 'false' or '0' left in storage cannot silently block a real user.
    return /^[A-Za-z]{2}$/.test(raw)
        ? { active: true, country: raw.toUpperCase() }
        : { active: false };
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
    // DEV OVERRIDE first — an explicit simulation must outrank a cached verdict.
    // Checking the cache before the flag meant that setting SIMULATE_SANCTIONS
    // after any normal page view did nothing here for up to 24h: the earlier
    // "not sanctioned" entry was returned and the flag silently ignored, so the
    // sanctioned UI looked broken when it was merely never asked to render.
    const simulated = readSimulatedSanctions();
    if (simulated.active) {
        console.warn('Simulating Sanctions Mode Active');
        return { sanctioned: true, country: simulated.country, cached: false, timedOut: false };
    }

    // Check cache first
    const cached = getCachedGeoCheck();
    if (cached) {
        return cached;
    }

    try {
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
        const simulated = readSimulatedSanctions();
        if (simulated.active) {
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
 * Country code from the cached geo check, without issuing a request.
 *
 * The sanctioned UI only renders after `isUserSanctioned()` /
 * `isUserSanctionedNonBlocking()` has resolved, and both write the country into
 * the same cache — so by the time a notice is on screen the country is already
 * known locally. Reading it here keeps the region-specific copy off the
 * per-render network path and avoids prop-drilling the country through three
 * unrelated call sites (pricing, scale, checkout).
 *
 * Returns undefined when the country is genuinely unknown — including the
 * fail-closed case where `isUserSanctioned()` blocked without ever reaching the
 * API. Callers must treat undefined as "no region-specific copy", never as a
 * guess.
 */
export function getCachedGeoCountry(): string | undefined {
    // The simulation is never persisted (see readSimulatedSanctions), so it has
    // to be consulted here or `SIMULATE_SANCTIONS=SY` would block without ever
    // showing the Syria-specific copy it exists to exercise.
    const simulated = readSimulatedSanctions();
    if (simulated.active) return simulated.country;

    return getCachedGeoCheck()?.country;
}

/**
 * Whether a blocked region has a local payment rail we can point the merchant
 * at. Stripe cannot process the charge, but that is not the same as "no way to
 * pay" — inside Syria the merchant pays through the self-serve Sham Cash
 * (شام كاش) panel on /checkout: transfer to our wallet, submit the reference,
 * a human matches it against the statement and approval activates the plan.
 *
 * This is the ONLY place the country → rail map lives. Everything that asks
 * the question reads it from here: `useLocalPaymentRail` (pricing grids and
 * checkout decide CTA vs. notice vs. panel), `useSelectPlan` (routes a blocked
 * paid-plan click to /checkout instead of a dead-end toast) and
 * `LocalPaymentAlternativeNote`. Adding a rail means extending this predicate,
 * not adding a check elsewhere.
 */
export function hasLocalPaymentAlternative(country?: string): boolean {
    return country?.toUpperCase() === 'SY';
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
