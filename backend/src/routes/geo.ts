import { FastifyInstance } from 'fastify';

/**
 * Geo Check Routes
 * 
 * Public endpoint for frontend to check if user's geo is sanctioned
 */
export default async function geoRoutes(fastify: FastifyInstance) {
    /**
     * GET /geo/check
     * 
     * Returns whether the user's geographic location is sanctioned.
     * This endpoint is public (no authentication required) and uses
     * server-derived geo data from the geo middleware.
     * 
     * Response:
     * - sanctioned: boolean - true if location is sanctioned
     * - country: string | undefined - ISO country code (if available)
     */
    fastify.get('/check', async (request, reply) => {
        const { isSanctionedGeo } = await import('../utils/sanctions');
        const { shouldBlockUnknownGeo } = await import('../middleware/geo');

        const geo = request.geo;
        const sanctioned = (geo && isSanctionedGeo(geo)) || shouldBlockUnknownGeo(geo);

        // Log geo check for monitoring (no PII)
        request.log.debug({
            geo,
            sanctioned,
            route: '/geo/check',
        }, 'Geo check request');

        return reply.send({
            sanctioned,
            country: geo?.country,
            // Do not expose region to avoid revealing precise location
        });
    });
}
