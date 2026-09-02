import { FastifyRequest, FastifyReply } from 'fastify';
import type { GeoLocation } from '../utils/sanctions';

type TrustedGeoSource = 'cloudflare' | 'vercel' | 'nginx';
const VALID_SOURCES: ReadonlySet<TrustedGeoSource> = new Set(['cloudflare', 'vercel', 'nginx']);
function getTrustedSource(): TrustedGeoSource | undefined {
    const raw = process.env.TRUSTED_GEO_HEADER_SOURCE;
    return raw && VALID_SOURCES.has(raw as TrustedGeoSource) ? (raw as TrustedGeoSource) : undefined;
}

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
 * Resolves the request's country/region for sanctions enforcement.
 *
 * SECURITY: Geo headers (cf-ipcountry, x-vercel-ip-country, x-geo-country) are
 * trivially spoofable by any client. They are ONLY consulted when
 * TRUSTED_GEO_HEADER_SOURCE explicitly names the active upstream proxy AND
 * that proxy is known to strip inbound copies before setting its own header.
 * Default behavior: ignore all geo headers, resolve from request.ip via
 * geoip-lite. nginx must also strip these headers (defense in depth).
 */
const HEADER_BY_SOURCE: Record<TrustedGeoSource, { country: string; region?: string }> = {
    cloudflare: { country: 'cf-ipcountry' },
    vercel: { country: 'x-vercel-ip-country' },
    nginx: { country: 'x-geo-country', region: 'x-geo-region' },
};

export async function geoMiddleware(request: FastifyRequest, _reply: FastifyReply) {
    const geo: GeoLocation = {
        country: undefined,
        region: undefined,
        source: 'unknown',
    };

    // Trusted-proxy header path. Only enabled when env explicitly opts in.
    const trustedSource = getTrustedSource();
    if (trustedSource) {
        const headerNames = HEADER_BY_SOURCE[trustedSource];
        const country = request.headers[headerNames.country] as string | undefined;
        // Cloudflare uses 'XX' for unknown, 'T1' for Tor — treat as unresolved.
        if (country && country !== 'XX' && country !== 'T1') {
            geo.country = country;
            geo.source = trustedSource;
            if (headerNames.region) {
                geo.region = request.headers[headerNames.region] as string | undefined;
            }
            request.geo = geo;
            return;
        }
    }

    // IP-based resolution via local GeoIP database. request.ip is the
    // X-Forwarded-For-resolved client IP because Fastify is configured with
    // trustProxy: true (index.ts).
    //
    // ⚠️ X-Forwarded-For ONLY — Fastify does NOT read X-Real-IP, so a request
    // carrying just that header geolocates the PROXY, not the client (verified
    // against a real instance 2026-09-02; the earlier "X-Real-IP / X-Forwarded-For"
    // wording here read as though either would do). And `trustProxy: true` takes
    // the LEFT-MOST entry of the chain, which is the caller-supplied end when
    // nginx appends via $proxy_add_x_forwarded_for. Both behaviours are pinned by
    // test/middleware/trustProxyClientIp.test.ts — this is the input to the
    // Rule 4 sanctions gate, so it must not drift silently under a Fastify bump.
    const ip = request.ip;
    if (ip && ip !== '127.0.0.1' && ip !== '::1') {
        const geoipModule = await import('geoip-lite');
        const geoip = geoipModule.default || geoipModule;
        const geoData = geoip.lookup(ip);

        if (geoData && geoData.country) {
            geo.country = geoData.country;
            geo.region = geoData.region;
            geo.source = 'geoip-lite';
            request.geo = geo;
            return;
        }
    }

    request.geo = geo;

    if (process.env.NODE_ENV === 'development') {
        request.log.debug({
            geo,
            ip: request.ip,
            trustedSource: trustedSource ?? null,
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
    if (!geo || !geo.country) {
        return true;
    }
    return false;
}
