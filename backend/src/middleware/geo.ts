import { FastifyRequest, FastifyReply } from 'fastify';
import type { GeoLocation } from '../utils/sanctions';

/**
 * Extend FastifyRequest to include geo property
 */
declare module 'fastify' {
    interface FastifyRequest {
        geo?: GeoLocation;
    }
}

/**
 * Geolocation Middleware
 * 
 * Extracts geographic location (country/region) from request headers
 * and attaches it to the request object for use in sanctions checking.
 * 
 * Priority order:
 * 1. Cloudflare headers (CF-IPCountry)
 * 2. Vercel headers (x-vercel-ip-country)
 * 3. Custom geo headers (X-Geo-Country, X-Geo-Region)
 * 4. Fallback: mark as unknown
 * 
 * Note: IP-based geolocation fallback (MaxMind, IP-API) can be added later.
 */
export async function geoMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const geo: GeoLocation = {
        country: undefined,
        region: undefined,
        source: 'unknown',
    };

    // Priority 1: Cloudflare headers
    const cfCountry = request.headers['cf-ipcountry'] as string | undefined;
    if (cfCountry && cfCountry !== 'XX' && cfCountry !== 'T1') {
        geo.country = cfCountry;
        geo.source = 'cloudflare';
        request.geo = geo;
        return;
    }

    // Priority 2: Vercel headers
    const vercelCountry = request.headers['x-vercel-ip-country'] as string | undefined;
    if (vercelCountry) {
        geo.country = vercelCountry;
        geo.source = 'vercel';
        request.geo = geo;
        return;
    }

    // Priority 3: Custom geo headers (from nginx or other proxy)
    const customCountry = request.headers['x-geo-country'] as string | undefined;
    const customRegion = request.headers['x-geo-region'] as string | undefined;
    if (customCountry) {
        geo.country = customCountry;
        geo.region = customRegion;
        geo.source = 'nginx';
        request.geo = geo;
        return;
    }

    // Priority 4: IP-based geolocation fallback
    // TODO: Implement IP geolocation service (MaxMind GeoIP2, IP-API, etc.)
    // For now, we leave geo as unknown
    // const ip = request.ip;
    // const geoData = await resolveIpToGeo(ip);
    // if (geoData) {
    //     geo.country = geoData.country;
    //     geo.region = geoData.region;
    //     geo.source = 'ipapi';
    // }

    // Attach geo to request (may be unknown)
    request.geo = geo;

    // Log geo resolution for debugging (only in development)
    if (process.env.NODE_ENV === 'development') {
        request.log.debug({
            geo,
            ip: request.ip,
            headers: {
                cfCountry,
                vercelCountry,
                customCountry,
                customRegion,
            },
        }, 'Geo resolution completed');
    }
}

/**
 * Safe-by-default: Should we block payments for unknown geo?
 * 
 * If geo cannot be resolved reliably, we default to blocking Stripe payments
 * for safety. This prevents potential sanctions violations.
 * 
 * @param geo - GeoLocation object
 * @returns true if payments should be blocked due to unknown geo
 */
export function shouldBlockUnknownGeo(geo?: GeoLocation): boolean {
    // If no geo object or no country, treat as unknown
    if (!geo || !geo.country) {
        return true;
    }

    // If country is present, allow (sanctions check will be done separately)
    return false;
}
