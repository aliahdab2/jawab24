import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';
import { partnerController } from '../controllers/partner';

/**
 * Partner Portal routes — the surface a reseller / country rep sees.
 *
 * Access model: any authenticated user may call; the controller resolves
 * whether the caller is a registered partner (via partners.user_id, or a PHONE
 * match on first visit — email is deliberately not an anchor, see
 * `resolvePartnerForUser`) and returns 403 otherwise. There is no partner
 * "role" flag on the session — the partners table is the authority.
 *
 * Read-only except for ONE write: recording a payment the rep collected by
 * hand. It writes to the payments ledger only and grants no entitlement.
 */
export default async function partnerRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.get(
            '/overview',
            { schema: { tags: ['Partner'], summary: 'Partner profile + attributed merchants (read-only)', security: auth } },
            partnerController.getOverview,
        );

        protectedRoutes.get(
            '/merchants/:userId',
            {
                schema: {
                    tags: ['Partner'],
                    summary: 'One attributed merchant\'s detail (read-only; 404 if not attributed to the caller)',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                },
            },
            partnerController.getMerchant,
        );

        protectedRoutes.post(
            '/merchants/:userId/payments',
            {
                // Recording cash is a low-frequency human action; anything near
                // this rate is a stuck client or an abuse attempt, not a rep.
                config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
                schema: {
                    tags: ['Partner'],
                    summary: 'Record a payment collected from an attributed merchant (404 if not attributed to the caller)',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                    body: {
                        type: 'object',
                        // `collectedBy`, `status` and any commission field are
                        // deliberately absent: the service forces them. A body
                        // that could set them would let a rep file his own cash
                        // as already settled.
                        additionalProperties: false,
                        required: ['amountCents', 'method', 'paidAt'],
                        properties: {
                            amountCents: { type: 'integer', minimum: 1, maximum: 10_000_000 },
                            currency: { type: 'string', minLength: 3, maxLength: 3 },
                            method: { type: 'string', enum: ['cash', 'sham_cash', 'bank_transfer', 'other'] },
                            paidAt: { type: 'string', format: 'date-time' },
                            coversPeriodStart: { type: 'string', format: 'date-time' },
                            coversPeriodEnd: { type: 'string', format: 'date-time' },
                            externalRef: { type: 'string', maxLength: 255 },
                            note: { type: 'string', maxLength: 1000 },
                            idempotencyKey: { type: 'string', maxLength: 64 },
                        },
                    },
                },
            },
            partnerController.recordPayment,
        );
    });
}
