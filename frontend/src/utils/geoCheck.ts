/**
 * Geo Check Utility for Frontend
 * 
 * Checks if the current user is in a sanctioned jurisdiction
 * by calling the backend geo check endpoint.
 */

export interface GeoCheckResponse {
    sanctioned: boolean;
    country?: string;
}

/**
 * Check if the current user's geo is sanctioned
 * 
 * This function calls the backend /geo/check endpoint which uses
 * server-derived geolocation data (cannot be spoofed by client).
 * 
 * @returns Promise<boolean> - true if sanctioned, false if allowed
 * 
 * Safe-by-default: Returns true (blocked) if the check fails or
 * if the backend cannot determine geo reliably.
 */
export async function isUserSanctioned(): Promise<boolean> {
    try {
        // DEV OVERRIDE: Allow simulating sanctions via localStorage
        if (typeof window !== 'undefined' && window.localStorage.getItem('SIMULATE_SANCTIONS') === 'true') {
            console.warn('Simulating Sanctions Mode Active');
            return true;
        }

        const response = await fetch('/api/geo/check', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // Include cookies for session
        });

        if (!response.ok) {
            // If geo check fails, default to blocked (safe-by-default)
            console.warn('Geo check failed, defaulting to blocked');
            return true;
        }

        const data: GeoCheckResponse = await response.json();
        return data.sanctioned;
    } catch (error) {
        // If network error or any other error, default to blocked
        console.error('Geo check error:', error);
        return true; // Safe-by-default
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
    } catch (error) {
        return undefined;
    }
}
