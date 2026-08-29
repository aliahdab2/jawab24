/**
 * HTTP layer for the offline (Sham Cash) payment rail.
 *
 * Two audiences, deliberately in one file because they share the claim's shape:
 * the merchant submits and reads their own claims; an admin lists, views the
 * receipt, and decides. Business rules live in `services/offlinePayments.ts`
 * (including the reviewer notification); shape/bounds validation lives in the
 * route JSON schemas; this file maps service outcomes to HTTP.
 *
 * Error contract — the same as the file these routes extend
 * (`controllers/payment.ts`): `{ error: <human sentence>, code: <snake_code> }`.
 * The client discriminates on `code` only, never on the HTTP status, because
 * the same URL is also answered by the route limiter (`RATE_LIMIT_EXCEEDED`)
 * and the schema validator (`VALIDATION_ERROR`).
 */
import { FastifyReply } from 'fastify';
import {
    normalizeTransferReference,
    OFFLINE_PAYMENT_RECEIPT_MAX_BYTES,
    OFFLINE_PAYMENT_REFERENCE_MAX,
    OFFLINE_PAYMENT_STATUSES,
    type OfflinePaymentRail,
    type OfflinePaymentStatus,
} from '@jawab24/shared';
import { offlinePaymentsService, type SubmitFailure } from '../services/offlinePayments';
import { validateAndNormalizeUpload, type UploadedImageCode } from '../services/imageUpload';
import type { AuthenticatedRequest } from '../middleware/auth';

interface SubmitBody {
    planId: string;
    billingInterval: 'month' | 'year';
    rail?: OfflinePaymentRail;
    transferReference: string;
    senderName?: string;
    note?: string;
    receipt?: { base64?: string; mimeType?: string } | null;
}

type ErrorCode =
    | 'reference_required'
    | 'reference_too_long'
    | 'offline_payments_unavailable'
    | 'not_found'
    | SubmitFailure['reason']
    | UploadedImageCode;

/** One table: code → status + sentence. The client shows its own i18n by code. */
const ERRORS: Record<Exclude<ErrorCode, 'marketplace_billed'>, { status: number; message: string }> = {
    reference_required: { status: 400, message: 'Enter the transfer reference from your receipt' },
    reference_too_long: { status: 400, message: 'The transfer reference is too long' },
    offline_payments_unavailable: { status: 403, message: 'Offline payments are not available right now' },
    not_found: { status: 404, message: 'Claim not found' },
    plan_not_found: { status: 404, message: 'Plan not found' },
    plan_not_purchasable: { status: 422, message: 'This plan cannot be bought on this rail' },
    duplicate_reference: { status: 409, message: 'This transfer reference has already been submitted' },
    too_many_pending: { status: 429, message: 'You already have transfers awaiting review' },
    unsupported_image_type: { status: 400, message: 'Use a JPG, PNG, or WEBP image' },
    invalid_image: { status: 400, message: 'The image could not be read' },
    image_too_large: { status: 413, message: 'The image is too large (max 2 MB)' },
    file_content_mismatch: { status: 400, message: 'The image contents do not match its type' },
    image_unreadable: { status: 400, message: 'The image could not be processed' },
};

function fail(reply: FastifyReply, code: Exclude<ErrorCode, 'marketplace_billed'>, extra: Record<string, unknown> = {}) {
    const { status, message } = ERRORS[code];
    return reply.status(status).send({ error: message, code, ...extra });
}

/** Is the Sham Cash rail live? Empty wallet number = OFF. */
function isShamCashConfigured(): boolean {
    return offlinePaymentsService.getRailConfig() !== null;
}

export const offlinePaymentsController = {
    /**
     * GET /payment/offline/config — always 200. `{ enabled: false }` when the
     * rail is off; a 404 was indistinguishable from a route that does not
     * exist yet (a frontend-before-backend deploy), so "off" and "not deployed"
     * looked the same to the client and to Sentry. Authenticated, NOT
     * geo-gated: VPN use is routine inside Syria, and a pay-TO wallet number
     * printed on the wallet's own QR card is not a secret.
     */
    async getConfig(request: AuthenticatedRequest, reply: FastifyReply) {
        if (!request.user?.userId) return reply.status(401).send({ error: 'Unauthorized' });
        const rail = offlinePaymentsService.getRailConfig();
        if (!rail) return reply.send({ enabled: false });
        return reply.send({ enabled: true, ...rail });
    },

    /** POST /payment/offline/claims — merchant submits a completed transfer. */
    async submit(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
        if (!isShamCashConfigured()) return fail(reply, 'offline_payments_unavailable');

        const body = request.body as SubmitBody;

        // Validate the NORMALIZED reference — the raw one is bounded by the
        // schema, but '---' normalizes to '' and 'ß' to 'SS' (longer).
        const transferReference = body.transferReference.trim();
        const normalized = normalizeTransferReference(transferReference);
        if (normalized.length === 0) return fail(reply, 'reference_required');
        if (normalized.length > OFFLINE_PAYMENT_REFERENCE_MAX) return fail(reply, 'reference_too_long');

        // The receipt is OPTIONAL evidence — the reference is what reconciles —
        // but if one is sent it goes through the same pipeline every merchant
        // upload uses. EXIF matters more here than anywhere: a photographed
        // receipt carries the phone's GPS.
        let receipt: { bytes: Buffer; mimeType: string } | null = null;
        if (body.receipt && body.receipt.base64) {
            const upload = await validateAndNormalizeUpload({
                base64: body.receipt.base64,
                mimeType: body.receipt.mimeType,
                maxBytes: OFFLINE_PAYMENT_RECEIPT_MAX_BYTES,
                sentry: {
                    message: 'Offline payment receipt could not be normalized',
                    fingerprint: 'offline-payment-receipt-normalize-failed',
                    extra: { userId },
                },
            });
            if (!upload.ok) return fail(reply, upload.code);
            receipt = { bytes: upload.bytes, mimeType: upload.mimeType };
        }

        const result = await offlinePaymentsService.submit({
            userId,
            rail: body.rail ?? 'sham_cash',
            planId: body.planId,
            billingInterval: body.billingInterval,
            transferReference,
            senderName: body.senderName?.trim() || null,
            note: body.note?.trim() || null,
            receipt,
        });

        if (!result.ok) {
            const { failure } = result;
            if (failure.reason === 'marketplace_billed') {
                request.log.info({ userId, code: failure.code }, 'Offline payment claim refused: marketplace-billed account');
                return reply.status(400).send({ error: failure.message, code: failure.code });
            }
            // A cross-account duplicate is the anti-replay guard firing — worth a line.
            if (failure.reason === 'duplicate_reference') {
                request.log.warn({ userId, reason: failure.reason }, 'Offline payment claim refused');
            }
            return fail(reply, failure.reason);
        }

        const { claim, replayed } = result;
        if (!replayed) {
            offlinePaymentsService.notifyReviewer(claim, userId);
            request.log.info(
                {
                    userId,
                    claimId: claim.id,
                    rail: claim.rail,
                    planId: claim.planId,
                    billingInterval: claim.billingInterval,
                    amountCents: claim.amountCents,
                    hasReceipt: claim.hasReceipt,
                },
                'Offline payment claim submitted',
            );
        }
        // 201 for a new claim; 200 when the same merchant resent the same
        // transfer (lost response, double tap) and we returned the existing one.
        return reply.status(replayed ? 200 : 201).send({ claim });
    },

    /** GET /payment/offline/claims — the merchant's own claims. Shape enforced by the route's response schema. */
    async listMine(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
        const claims = await offlinePaymentsService.listForUser(userId);
        return reply.send({ claims });
    },

    /** GET /admin/offline-payments?status=&cursor=&limit= */
    async adminList(request: AuthenticatedRequest, reply: FastifyReply) {
        const { status, cursor, limit } = (request.query ?? {}) as { status?: string; cursor?: string; limit?: number };
        const page = await offlinePaymentsService.list({
            status: status && (OFFLINE_PAYMENT_STATUSES as readonly string[]).includes(status) ? (status as OfflinePaymentStatus) : undefined,
            cursor: cursor ?? null,
            limit,
        });
        return reply.send(page);
    },

    /**
     * GET /admin/offline-payments/:id/receipt — the image, from OUR origin.
     * The bytes live in Postgres precisely so this route is the only way to see
     * them. `no-store` so it is not left in a shared cache after the reviewer
     * closes the page. A financial document: the read is logged.
     */
    async adminGetReceipt(request: AuthenticatedRequest, reply: FastifyReply) {
        const { id } = request.params as { id: string };
        const receipt = await offlinePaymentsService.getReceipt(id);
        if (!receipt) return fail(reply, 'not_found');
        request.log.info({ adminUserId: request.user?.userId, claimId: id }, 'Offline payment receipt viewed');
        return reply
            .header('content-type', receipt.mimeType)
            .header('cache-control', 'no-store')
            .header('content-disposition', 'inline')
            .send(receipt.bytes);
    },

    /**
     * POST /admin/offline-payments/:id/review — decide. APPROVE ACTIVATES the
     * plan for the claimed period in the same transaction (see the service).
     * 409 carries the current row so a stale queue can replace the card in
     * place instead of reloading.
     */
    async adminReview(request: AuthenticatedRequest, reply: FastifyReply) {
        const adminUserId = request.user?.userId;
        if (!adminUserId) return reply.status(401).send({ error: 'Unauthorized' });
        const { id } = request.params as { id: string };
        const { decision, reviewNote } = request.body as { decision: 'approved' | 'rejected'; reviewNote?: string };

        const result = await offlinePaymentsService.review(id, decision, adminUserId, reviewNote ?? null);
        if (result.outcome === 'not_found') return fail(reply, 'not_found');
        if (result.outcome === 'already_reviewed') {
            return reply.status(409).send({
                error: 'This claim was already reviewed',
                code: 'already_reviewed',
                data: result.claim,
            });
        }
        request.log.info(
            {
                adminUserId,
                claimId: id,
                targetUserId: result.claim.userId,
                decision,
                grantedSubscriptionId: result.claim.grantedSubscriptionId,
            },
            'Offline payment claim reviewed',
        );
        return reply.send({ success: true, data: result.claim });
    },
};
