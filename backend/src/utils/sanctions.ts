/**
 * Sanctions Compliance Utilities
 * 
 * This module defines sanctioned jurisdictions and provides utilities
 * to check if a geographic location is subject to international sanctions.
 * 
 * Used to ensure Stripe payment processing is never used for sanctioned regions.
 */

/**
 * List of sanctioned countries (ISO 3166-1 alpha-2 codes)
 * 
 * These countries are subject to comprehensive international sanctions
 * and cannot use Stripe payment services.
 */
export const SANCTIONED_COUNTRIES = [
    'CU', // Cuba
    'IR', // Iran
    'KP', // North Korea (Democratic People's Republic of Korea)
    'SY', // Syria
] as const;

/**
 * List of sanctioned regions (ISO 3166-2 codes)
 * 
 * These regions within countries are subject to sanctions
 * and cannot use Stripe payment services.
 */
export const SANCTIONED_REGIONS = [
    'UA-43', // Crimea (Ukraine)
    'UA-09', // Luhansk (Ukraine)
    'UA-14', // Donetsk (Ukraine)
] as const;

/**
 * Geographic location information
 */
export interface GeoLocation {
    /** ISO 3166-1 alpha-2 country code (e.g., 'US', 'SY') */
    country?: string;
    /** ISO 3166-2 region code (e.g., 'UA-43') */
    region?: string;
    /** Source of geolocation data */
    source?: 'cloudflare' | 'vercel' | 'nginx' | 'ipapi' | 'geoip-lite' | 'maxmind' | 'unknown';
}

/**
 * Check if a geographic location is subject to sanctions
 * 
 * @param country - ISO 3166-1 alpha-2 country code (e.g., 'SY', 'IR')
 * @param region - Optional ISO 3166-2 region code (e.g., 'UA-43')
 * @returns true if the location is sanctioned, false otherwise
 * 
 * @example
 * ```typescript
 * isSanctioned('SY') // true - Syria is sanctioned
 * isSanctioned('US') // false - United States is not sanctioned
 * isSanctioned('UA', 'UA-43') // true - Crimea is sanctioned
 * isSanctioned('UA', 'UA-01') // false - Kyiv is not sanctioned
 * isSanctioned(undefined) // false - unknown location is not sanctioned
 * ```
 */
export function isSanctioned(country?: string, region?: string): boolean {
    // If no country provided, cannot determine sanctions status
    if (!country) {
        return false;
    }

    // Normalize to uppercase for comparison
    const normalizedCountry = country.toUpperCase();
    const normalizedRegion = region?.toUpperCase();

    // Check if country is in sanctioned list
    if (SANCTIONED_COUNTRIES.includes(normalizedCountry as typeof SANCTIONED_COUNTRIES[number])) {
        return true;
    }

    // Check if region is in sanctioned list
    if (normalizedRegion && SANCTIONED_REGIONS.includes(normalizedRegion as typeof SANCTIONED_REGIONS[number])) {
        return true;
    }

    return false;
}

/**
 * Check if a GeoLocation object represents a sanctioned jurisdiction
 * 
 * @param geo - GeoLocation object with country and optional region
 * @returns true if the location is sanctioned, false otherwise
 * 
 * @example
 * ```typescript
 * isSanctionedGeo({ country: 'SY' }) // true
 * isSanctionedGeo({ country: 'US' }) // false
 * isSanctionedGeo({ country: 'UA', region: 'UA-43' }) // true
 * isSanctionedGeo({}) // false
 * ```
 */
export function isSanctionedGeo(geo: GeoLocation): boolean {
    return isSanctioned(geo.country, geo.region);
}

/**
 * Get a human-readable description of why a location is sanctioned
 * 
 * @param country - ISO 3166-1 alpha-2 country code
 * @param region - Optional ISO 3166-2 region code
 * @returns Description string or null if not sanctioned
 */
export function getSanctionReason(country?: string, region?: string): string | null {
    if (!country) {
        return null;
    }

    const normalizedCountry = country.toUpperCase();
    const normalizedRegion = region?.toUpperCase();

    // Check region first (more specific)
    if (normalizedRegion) {
        switch (normalizedRegion) {
            case 'UA-43':
                return 'Crimea region is subject to international sanctions';
            case 'UA-09':
                return 'Luhansk region is subject to international sanctions';
            case 'UA-14':
                return 'Donetsk region is subject to international sanctions';
        }
    }

    // Check country
    switch (normalizedCountry) {
        case 'CU':
            return 'Cuba is subject to international sanctions';
        case 'IR':
            return 'Iran is subject to international sanctions';
        case 'KP':
            return 'North Korea is subject to international sanctions';
        case 'SY':
            return 'Syria is subject to international sanctions';
        default:
            return null;
    }
}
