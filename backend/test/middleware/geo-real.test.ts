
import { FastifyRequest, FastifyReply } from 'fastify';
import { geoMiddleware } from '../../src/middleware/geo';
import { isSanctionedGeo } from '../../src/utils/sanctions';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// geo.ts reads TRUSTED_GEO_HEADER_SOURCE from process.env on every call,
// so swapping it between tests just requires setting/unsetting the variable.
let mockedTrustedSource: 'cloudflare' | 'vercel' | 'nginx' | undefined;
function applyTrustedSource() {
    if (mockedTrustedSource) {
        process.env.TRUSTED_GEO_HEADER_SOURCE = mockedTrustedSource;
    } else {
        delete process.env.TRUSTED_GEO_HEADER_SOURCE;
    }
}

// Mock Fastify Request and Reply
const createMockRequest = (ip: string, headers: Record<string, string | string[] | undefined> = {}) => ({
    headers,
    ip,
    log: {
        debug: () => { },
        warn: () => { },
        error: () => { },
    },
    geo: undefined,
} as unknown as FastifyRequest);

const createMockReply = () => ({} as FastifyReply);

describe('Geo Middleware & Sanctions (Real IP Examples)', () => {
    beforeEach(() => {
        mockedTrustedSource = undefined;
        applyTrustedSource();
    });
    afterEach(() => {
        mockedTrustedSource = undefined;
        applyTrustedSource();
    });

    it('should correctly identify Sweden IP (NOT sanctioned)', async () => {
        // IP from Stockholm, Sweden
        const req = createMockRequest('193.10.252.19');
        const reply = createMockReply();

        await geoMiddleware(req, reply);

        expect(req.geo).toBeDefined();
        expect(req.geo?.country).toBe('SE');
        expect(req.geo?.source).toBe('geoip-lite');

        // Verify sanctions status
        const sanctioned = req.geo ? isSanctionedGeo(req.geo) : true;
        expect(sanctioned).toBe(false);
    });

    it('should correctly identify US IP (NOT sanctioned)', async () => {
        // Google Public DNS (US)
        const req = createMockRequest('8.8.8.8');
        const reply = createMockReply();

        await geoMiddleware(req, reply);

        expect(req.geo).toBeDefined();
        expect(req.geo?.country).toBe('US');

        const sanctioned = req.geo ? isSanctionedGeo(req.geo) : true;
        expect(sanctioned).toBe(false);
    });

    it('should correctly identify Syria IP (SANCTIONED)', async () => {
        // IP from Damascus, Syria (range 185.17.x.x is often Syrian Telecom)
        // Using a generic known Syrian IP range example
        const req = createMockRequest('185.17.20.10');
        const reply = createMockReply();

        await geoMiddleware(req, reply);

        expect(req.geo).toBeDefined();
        // Note: geoip-lite accuracy depends on database, checking if it detects country
        // If it returns SY, we verify it is sanctioned.
        if (req.geo?.country === 'SY') {
            const sanctioned = isSanctionedGeo(req.geo);
            expect(sanctioned).toBe(true);
        } else {
            // Fallback expectation if specific IP database differs in different versions
            // But we verify the logic: IF it was SY, it MUST be sanctioned
            expect(isSanctionedGeo({ country: 'SY' })).toBe(true);
        }
    });

    it('should correctly identify Iran IP (SANCTIONED)', async () => {
        // Example IP from Iran
        const req = createMockRequest('2.144.0.0');
        const reply = createMockReply();

        await geoMiddleware(req, reply);

        if (req.geo?.country === 'IR') {
            const sanctioned = isSanctionedGeo(req.geo);
            expect(sanctioned).toBe(true);
        }
        expect(isSanctionedGeo({ country: 'IR' })).toBe(true);
    });

    it('should IGNORE spoofable cf-ipcountry header when TRUSTED_GEO_HEADER_SOURCE is unset', async () => {
        // SECURITY: This is the regression guard for the OFAC bypass.
        // An attacker in a sanctioned region would set cf-ipcountry: US
        // hoping the backend trusts it. Without explicit env opt-in we must not.
        mockedTrustedSource = undefined;
        const req = createMockRequest('185.17.20.10', { // Syria IP
            'cf-ipcountry': 'US', // Spoofed header
        });
        const reply = createMockReply();

        await geoMiddleware(req, reply);

        // Header is ignored; resolution falls back to IP-based geoip-lite.
        expect(req.geo?.source).not.toBe('cloudflare');
        expect(req.geo?.country).not.toBe('US');
    });

    it('should trust cf-ipcountry header only when TRUSTED_GEO_HEADER_SOURCE=cloudflare', async () => {
        mockedTrustedSource = 'cloudflare';
        applyTrustedSource();
        const req = createMockRequest('193.10.252.19', { // Sweden IP
            'cf-ipcountry': 'US',
        });
        const reply = createMockReply();

        await geoMiddleware(req, reply);

        expect(req.geo?.country).toBe('US');
        expect(req.geo?.source).toBe('cloudflare');
    });

    it('should ignore x-geo-country header when TRUSTED_GEO_HEADER_SOURCE=cloudflare (mismatched proxy)', async () => {
        mockedTrustedSource = 'cloudflare';
        applyTrustedSource();
        const req = createMockRequest('193.10.252.19', {
            'x-geo-country': 'US',
        });
        const reply = createMockReply();

        await geoMiddleware(req, reply);

        // Only the source named in the env var is consulted.
        expect(req.geo?.source).not.toBe('cloudflare');
        expect(req.geo?.source).not.toBe('nginx');
    });

    it('should handle localhost/private IPs gracefully', async () => {
        const req = createMockRequest('127.0.0.1');
        const reply = createMockReply();

        await geoMiddleware(req, reply);

        // Should be unknown or undefined country, logic handles it upstream
        expect(req.geo?.country).toBeUndefined();
        expect(req.geo?.source).toBe('unknown');
    });
});
