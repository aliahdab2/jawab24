import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticatedRequest } from '../middleware/auth';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { partnerPortalService } from '../services/partnerPortal';
import { PaymentValidationError, type PaymentMethod } from '../services/payments';

/**
 * Partner Portal controller — HTTP concerns for the reseller-facing surface.
 * Read-only: the portal exposes no mutations.
 */
export class PartnerController {
    /** GET /partner/overview — the partner's profile + their attributed merchants. */
    async getOverview(request: FastifyRequest, reply: FastifyReply) {
        const authReq = request as AuthenticatedRequest;
        const auth = authReq.user;
        // Embedded platform sessions prove a store, not a person — same
        // rejection requireAdmin applies.
        if (!auth?.userId || auth.embeddedPlatform) {
            return reply.status(401).send({ success: false, error: 'Authentication required' });
        }

        try {
            const [user] = await db
                .select({ id: users.id, email: users.email, phone: users.phone })
                .from(users)
                .where(eq(users.id, auth.userId))
                .limit(1);
            if (!user) {
                return reply.status(401).send({ success: false, error: 'Authentication required' });
            }

            const partner = await partnerPortalService.resolvePartnerForUser(user);
            if (!partner) {
                // Not a partner — the frontend redirects to the dashboard.
                return reply.status(403).send({ success: false, error: 'Not a partner account', code: 'NOT_A_PARTNER' });
            }

            const data = await partnerPortalService.getOverview(partner);
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Partner overview failed');
            return reply.status(500).send({ success: false, error: 'Failed to load partner overview' });
        }
    }

    /** GET /partner/merchants/:userId — one attributed merchant's detail. */
    async getMerchant(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
        const authReq = request as AuthenticatedRequest;
        const auth = authReq.user;
        if (!auth?.userId || auth.embeddedPlatform) {
            return reply.status(401).send({ success: false, error: 'Authentication required' });
        }

        try {
            const [user] = await db
                .select({ id: users.id, email: users.email, phone: users.phone })
                .from(users)
                .where(eq(users.id, auth.userId))
                .limit(1);
            if (!user) {
                return reply.status(401).send({ success: false, error: 'Authentication required' });
            }

            const partner = await partnerPortalService.resolvePartnerForUser(user);
            if (!partner) {
                return reply.status(403).send({ success: false, error: 'Not a partner account', code: 'NOT_A_PARTNER' });
            }

            const data = await partnerPortalService.getMerchantDetail(partner.id, request.params.userId);
            // 404 (not 403) when the merchant belongs to someone else — the
            // status code must not confirm that the id exists.
            if (!data) {
                return reply.status(404).send({ success: false, error: 'Merchant not found' });
            }

            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Partner merchant detail failed');
            return reply.status(500).send({ success: false, error: 'Failed to load merchant' });
        }
    }

    /**
     * POST /partner/merchants/:userId/payments — record money the rep collected.
     *
     * The only write on this surface. Everything that decides how much money it
     * is worth to us — who collected it, whether it counts as settled, the
     * commission snapshot — is set by the service from the resolved partner,
     * never from the request body.
     */
    async recordPayment(
        request: FastifyRequest<{ Params: { userId: string }; Body: RecordPaymentBody }>,
        reply: FastifyReply,
    ) {
        const authReq = request as unknown as AuthenticatedRequest;
        const auth = authReq.user;
        if (!auth?.userId || auth.embeddedPlatform) {
            return reply.status(401).send({ success: false, error: 'Authentication required' });
        }

        try {
            const [user] = await db
                .select({ id: users.id, email: users.email, phone: users.phone })
                .from(users)
                .where(eq(users.id, auth.userId))
                .limit(1);
            if (!user) {
                return reply.status(401).send({ success: false, error: 'Authentication required' });
            }

            const partner = await partnerPortalService.resolvePartnerForUser(user);
            if (!partner) {
                return reply.status(403).send({ success: false, error: 'Not a partner account', code: 'NOT_A_PARTNER' });
            }

            const body = request.body;
            const payment = await partnerPortalService.recordPayment(
                partner,
                request.params.userId,
                {
                    amountCents: body.amountCents,
                    currency: body.currency,
                    method: body.method,
                    paidAt: new Date(body.paidAt),
                    coversPeriodStart: body.coversPeriodStart ? new Date(body.coversPeriodStart) : null,
                    coversPeriodEnd: body.coversPeriodEnd ? new Date(body.coversPeriodEnd) : null,
                    externalRef: body.externalRef ?? null,
                    note: body.note ?? null,
                    idempotencyKey: body.idempotencyKey ?? null,
                },
                user.id,
            );

            // Same 404-not-403 rule as the read path: the status code must not
            // confirm that a merchant id exists.
            if (!payment) {
                return reply.status(404).send({ success: false, error: 'Merchant not found' });
            }

            return reply.status(201).send({
                success: true,
                data: {
                    id: payment.id,
                    amountCents: payment.amountCents,
                    // Gross and net only — never the rate (owner ruling 2026-08-16).
                    netOwedCents: payment.amountCents - payment.commissionCents,
                    currency: payment.currency,
                    method: payment.method,
                    status: payment.status,
                    paidAt: payment.paidAt,
                },
            });
        } catch (error) {
            if (error instanceof PaymentValidationError) {
                return reply.status(400).send({ success: false, error: error.message, code: error.code });
            }
            request.log.error(error, 'Partner payment record failed');
            return reply.status(500).send({ success: false, error: 'Failed to record payment' });
        }
    }
}

interface RecordPaymentBody {
    amountCents: number;
    currency?: string;
    method: PaymentMethod;
    paidAt: string;
    coversPeriodStart?: string;
    coversPeriodEnd?: string;
    externalRef?: string;
    note?: string;
    idempotencyKey?: string;
}

export const partnerController = new PartnerController();
