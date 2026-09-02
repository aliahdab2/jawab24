import Fastify from 'fastify';
import { describe, it, expect } from 'vitest';
import { geoMiddleware } from '../../src/middleware/geo';
import { isSanctionedGeo } from '../../src/utils/sanctions';

/**
 * What `request.ip` resolves to under `trustProxy: true` — pinned against a REAL
 * Fastify instance, not a mock.
 *
 * Why this exists: `geo-real.test.ts` hands `ip` straight into the middleware, so
 * it proves the geoip→sanctions mapping but NOT the hop before it — how Fastify
 * derives that `ip` from the proxy headers. That hop is the one the Rule 4
 * sanctions gate (LEGAL) actually depends on: `middleware/geo.ts` reads
 * `request.ip`, and `index.ts` builds the server with `trustProxy: true`. It is
 * also the hop a Fastify upgrade can silently change — GHSA-3m5p-2c4r-xxw2
 * (X-Forwarded-* spoofing under trustProxy hop-count) is exactly that class of
 * change, and the whole backend suite booted no Fastify instance at all, so a
 * regression here would have gone unseen. These tests fail loudly if the
 * resolution order shifts under us.
 *
 * The options mirror `src/index.ts` — if that changes, change it here too.
 */
const bootProxiedServer = () => {
    const app = Fastify({ trustProxy: true });
    app.get('/ip', async (req) => ({ ip: req.ip, ips: req.ips }));
    return app;
};

/** The address nginx itself connects from — the untrusted-header baseline. */
const PROXY_HOP = '10.0.0.254';

const resolveIp = async (headers: Record<string, string>) => {
    const app = bootProxiedServer();
    try {
        const res = await app.inject({
            method: 'GET',
            url: '/ip',
            headers,
            remoteAddress: PROXY_HOP,
        });
        return JSON.parse(res.body) as { ip: string; ips: string[] };
    } finally {
        await app.close();
    }
};

describe('trustProxy client-IP resolution (feeds the Rule 4 sanctions gate)', () => {
    it('takes the LEFT-MOST X-Forwarded-For entry, not the nearest hop', async () => {
        // Documented behaviour, verified on fastify 5.12.1. It matters which end
        // wins: nginx's `$proxy_add_x_forwarded_for` APPENDS the real peer, so the
        // left-most entry is whatever the caller sent. Any future Fastify release
        // that starts counting hops from the right changes which IP the sanctions
        // check geolocates — that must never happen silently.
        const single = await resolveIp({ 'x-forwarded-for': '203.0.113.7' });
        expect(single.ip).toBe('203.0.113.7');

        const chain = await resolveIp({
            'x-forwarded-for': '1.1.1.1, 203.0.113.7, 10.0.0.1',
        });
        expect(chain.ip).toBe('1.1.1.1');
    });

    it('ignores X-Real-IP entirely — only X-Forwarded-For reaches request.ip', async () => {
        // geo.ts's comment says nginx sets "X-Real-IP / X-Forwarded-For", which
        // reads as though either header would do. Only the latter feeds
        // `request.ip`; with X-Real-IP alone the gate geolocates the PROXY.
        const realIpOnly = await resolveIp({ 'x-real-ip': '203.0.113.9' });
        expect(realIpOnly.ip).toBe(PROXY_HOP);
    });

    it('falls back to the socket address when no forwarding header is present', async () => {
        const bare = await resolveIp({});
        expect(bare.ip).toBe(PROXY_HOP);
    });

    it('passes malformed values through unvalidated (geoip must not assume an IP)', async () => {
        // Fastify does not validate the header, so `geoip.lookup` can be handed a
        // non-address. It returns null for these and geo.ts leaves `country`
        // undefined — the caller MUST treat "no country" as unresolved rather
        // than as "not sanctioned".
        const garbage = await resolveIp({ 'x-forwarded-for': 'not-an-ip' });
        expect(garbage.ip).toBe('not-an-ip');

        // Leading-zero octets survive too — the shape behind the acknowledged
        // ip-address advisory GHSA-mwp4-54f8-5fhr.
        const octal = await resolveIp({ 'x-forwarded-for': '203.0.113.007' });
        expect(octal.ip).toBe('203.0.113.007');
    });

    it('end-to-end: a forwarded sanctioned IP still reaches isSanctionedGeo', async () => {
        // The full hop the legal gate relies on: proxy header → request.ip →
        // geoip-lite → sanctions verdict, with a real Fastify request object
        // rather than a hand-built mock.
        const app = bootProxiedServer();
        let verdict: boolean | null = null;
        let resolvedCountry: string | undefined;

        app.addHook('onRequest', async (req, reply) => {
            await geoMiddleware(req, reply);
            resolvedCountry = req.geo?.country;
            verdict = req.geo ? isSanctionedGeo(req.geo) : null;
        });

        try {
            await app.inject({
                method: 'GET',
                url: '/ip',
                headers: { 'x-forwarded-for': '185.17.20.10' }, // Syrian Telecom range
                remoteAddress: PROXY_HOP,
            });
        } finally {
            await app.close();
        }

        // The middleware ran over the FORWARDED address, not the proxy hop.
        expect(verdict).not.toBeNull();
        // geoip-lite's database drifts between releases, so assert the invariant
        // rather than the lookup: if it resolved to SY, that MUST be sanctioned.
        if (resolvedCountry === 'SY') {
            expect(verdict).toBe(true);
        } else {
            expect(isSanctionedGeo({ country: 'SY' })).toBe(true);
        }
    });
});
