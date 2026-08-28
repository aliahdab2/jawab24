/**
 * HTTP layer for the offline (Sham Cash) payment rail.
 *
 * Two audiences, deliberately in one file because they share the claim's shape:
 * the merchant submits and reads their own claims; an admin lists, views the
 * receipt, and moves the status. Business rules live in
 * `services/offlinePayments.ts`; validation of the uploaded bytes lives here,
 * because it is an HTTP-input concern.
 */
import { FastifyReply } from 'fastify';
import {
    OFFLINE_PAYMENT_NOTE_MAX,
    OFFLINE_PAYMENT_RECEIPT_MAX_BYTES,
    OFFLINE_PAYMENT_RECEIPT_MIME_TYPES,
    OFFLINE_PAYMENT_REFERENCE_MAX,
    OFFLINE_PAYMENT_SENDER_NAME_MAX,
    OFFLINE_PAYMENT_STATUSES,
    type OfflinePaymentStatus,
} from '@jawab24/shared';
import { config } from '../config';
import { offlinePaymentsService } from '../services/offlinePayments';
import { bufferMatchesMime } from '../services/kb/file-extractor';
import { normalizeImage } from '../services/imageNormalize';
import { sendThrottledAdminAlert } from '../services/adminAlerts';
import { captureError } from '../utils/sentryHelpers';
import { UUIDSchema } from '../utils/validation';
import type { AuthenticatedRequest } from '../middleware/auth';

interface SubmitBody {
    planId?: string;
    billingInterval?: string;
    transferReference?: string;
    senderName?: string;
    note?: string;
    receipt?: { base64?: string; mimeType?: string } | null;
}

/**
 * Is the Sham Cash rail live? Empty wallet number = OFF, and the whole surface
 * disappears. Fails safe: we never show a merchant a payment panel with no
 * account behind it.
 */
export function isShamCashConfigured(): boolean {
    return Boolean(config.shamCash.walletNumber);
}

export const offlinePaymentsController = {
    /**
     * GET /payment/offline/config — the wallet details the panel renders.
     *
     * Authenticated: these are the owner's real financial identifiers and there
     * is no reason for an anonymous visitor to be able to scrape them. 404 when
     * the rail is off, so the client's "is this available" check and its "give
     * me the details" call are the same call.
     */
    async getConfig(request: AuthenticatedRequest, reply: FastifyReply) {
        if (!isShamCashConfigured()) {
            return reply.status(404).send({ error: 'offline_payments_unavailable' });
        }
        return reply.send({
            rail: 'sham_cash',
            walletNumber: config.shamCash.walletNumber,
            walletName: config.shamCash.walletName || null,
            qrImageUrl: config.shamCash.qrImageUrl || null,
            currency: 'usd',
        });
    },

    /** POST /payment/offline/claims — merchant submits a completed transfer. */
    async submit(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
        if (!isShamCashConfigured()) {
            return reply.status(404).send({ error: 'offline_payments_unavailable' });
        }

        const body = (request.body ?? {}) as SubmitBody;

        if (!body.planId || !UUIDSchema.safeParse(body.planId).success) {
            return reply.status(400).send({ error: 'invalid_plan' });
        }
        const billingInterval = body.billingInterval === 'year' ? 'year' : 'month';

        const transferReference = (body.transferReference ?? '').trim();
        if (!transferReference) {
            return reply.status(400).send({ error: 'reference_required' });
        }
        if (transferReference.length > OFFLINE_PAYMENT_REFERENCE_MAX) {
            return reply.status(400).send({ error: 'reference_too_long' });
        }
        const senderName = (body.senderName ?? '').trim().slice(0, OFFLINE_PAYMENT_SENDER_NAME_MAX) || null;
        const note = (body.note ?? '').trim().slice(0, OFFLINE_PAYMENT_NOTE_MAX) || null;

        // The receipt is OPTIONAL evidence — the reference is what reconciles —
        // but if one is sent it goes through the same allowlist + magic-byte +
        // EXIF-strip path every merchant upload uses. EXIF matters more here than
        // anywhere else: a photographed receipt carries the phone's GPS.
        let receipt: { bytes: Buffer; mimeType: string } | null = null;
        if (body.receipt && body.receipt.base64) {
            const mimeType = body.receipt.mimeType ?? '';
            if (!OFFLINE_PAYMENT_RECEIPT_MIME_TYPES.includes(mimeType as typeof OFFLINE_PAYMENT_RECEIPT_MIME_TYPES[number])) {
                return reply.status(400).send({ error: 'unsupported_image_type' });
            }
            const buffer = Buffer.from(body.receipt.base64, 'base64');
            if (buffer.length === 0) return reply.status(400).send({ error: 'invalid_image' });
            if (buffer.length > OFFLINE_PAYMENT_RECEIPT_MAX_BYTES) {
                return reply.status(413).send({ error: 'image_too_large' });
            }
            if (!bufferMatchesMime(buffer, mimeType)) {
                return reply.status(400).send({ error: 'file_content_mismatch' });
            }
            try {
                receipt = { bytes: await normalizeImage(buffer, mimeType), mimeType };
            } catch (err) {
                captureError(err, 'Offline payment receipt could not be normalized', {
                    level: 'warning',
                    fingerprint: ['offline-payment-receipt-normalize-failed'],
                    tags: { component: 'imageNormalize' },
                    extra: { userId, mimeType, bytes: buffer.length },
                });
                return reply.status(400).send({ error: 'image_unreadable' });
            }
        }

        const result = await offlinePaymentsService.submit({
            userId,
            rail: 'sham_cash',
            planId: body.planId,
            billingInterval,
            transferReference,
            senderName,
            note,
            receipt,
        });

        if (!result.ok) {
            // 409 for the duplicate: it is a conflict with an existing claim, not
            // malformed input, and the client shows a distinct message for it —
            // "we already have this transfer" must never read as "try again".
            const status = result.reason === 'duplicate_reference' ? 409
                : result.reason === 'too_many_pending' ? 429
                    : 400;
            return reply.status(status).send({ error: result.reason });
        }

        // Tell the reviewer there is something to review. Fire-and-forget: the
        // claim is already recorded, and a mail outage must not fail the
        // merchant's submission. Dedup key is the claim id, so a retried request
        // that lands twice still mails once.
        void sendThrottledAdminAlert({
            dedupKey: `offline-payment:notify:${result.row.id}`,
            cooldownSeconds: 24 * 60 * 60,
            level: 'warning',
            message: 'Offline payment claim submitted',
            tags: { component: 'offlinePayments', rail: 'sham_cash' },
            extra: { claimId: result.row.id, userId, planSlug: result.row.planSlug },
            subject: `Sham Cash payment to review — ${result.row.planName}`,
            html: buildReviewEmail(result.row.planName, result.row.billingInterval, result.row.amountCents, result.row.transferReference, result.row.hasReceipt),
        }).catch(() => { /* best-effort */ });

        return reply.status(201).send({ claim: result.row });
    },

    /** GET /payment/offline/claims — the merchant's own claims (the «under review» state). */
    async listMine(request: AuthenticatedRequest, reply: FastifyReply) {
        const userId = request.user?.userId;
        if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
        const claims = await offlinePaymentsService.listForUser(userId);
        return reply.send({ claims });
    },

    /** GET /admin/offline-payments?status=pending_review */
    async adminList(request: AuthenticatedRequest, reply: FastifyReply) {
        const { status } = (request.query ?? {}) as { status?: string };
        if (status && !OFFLINE_PAYMENT_STATUSES.includes(status as OfflinePaymentStatus)) {
            return reply.status(400).send({ error: 'invalid_status' });
        }
        const claims = await offlinePaymentsService.list({ status: status as OfflinePaymentStatus | undefined });
        return reply.send({ claims });
    },

    /**
     * GET /admin/offline-payments/:id/receipt — the image, from OUR origin.
     *
     * The bytes live in Postgres precisely so this route is the only way to see
     * them: a receipt is a financial document and the media bucket is public
     * (backend/docs/OBJECT_STORAGE.md §4). `no-store` so it is not left in a
     * shared cache after the reviewer closes the page.
     */
    async adminGetReceipt(request: AuthenticatedRequest, reply: FastifyReply) {
        const { id } = request.params as { id: string };
        if (!UUIDSchema.safeParse(id).success) {
            return reply.status(400).send({ error: 'invalid_id' });
        }
        const receipt = await offlinePaymentsService.getReceipt(id);
        if (!receipt) return reply.status(404).send({ error: 'not_found' });
        return reply
            .header('content-type', receipt.mimeType)
            .header('cache-control', 'no-store')
            .header('content-disposition', 'inline')
            .send(receipt.bytes);
    },

    /**
     * POST /admin/offline-payments/:id/review — record the decision.
     *
     * Recording a decision is NOT granting: the plan is still opened through the
     * admin manual-upgrade path, which stays the single grant choke point. The
     * response says so explicitly so a future caller cannot mistake this for an
     * entitlement write.
     */
    async adminReview(request: AuthenticatedRequest, reply: FastifyReply) {
        const { id } = request.params as { id: string };
        if (!UUIDSchema.safeParse(id).success) {
            return reply.status(400).send({ error: 'invalid_id' });
        }
        const { decision, reviewNote } = (request.body ?? {}) as { decision?: string; reviewNote?: string };
        if (decision !== 'approved' && decision !== 'rejected') {
            return reply.status(400).send({ error: 'invalid_decision' });
        }
        const moved = await offlinePaymentsService.review(id, decision, request.user?.userId, reviewNote ?? null);
        if (!moved) {
            // Already reviewed, or gone. Not an error the admin caused — the
            // queue is simply stale; the client refetches.
            return reply.status(409).send({ error: 'already_reviewed' });
        }
        return reply.send({ success: true, grantsSubscription: false });
    },
};

/** Plain, self-contained review email — no template engine on this path. */
function buildReviewEmail(
    planName: string,
    billingInterval: string,
    amountCents: number,
    transferReference: string,
    hasReceipt: boolean,
): string {
    const amount = `$${(amountCents / 100).toFixed(2)}`;
    const rows: Array<[string, string]> = [
        ['Plan', `${planName} (${billingInterval === 'year' ? 'yearly' : 'monthly'})`],
        ['Amount', amount],
        ['Transfer reference', transferReference],
        ['Receipt image', hasReceipt ? 'attached — open the admin review page' : 'not provided'],
    ];
    const body = rows
        .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${k}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>`)
        .join('');
    return `<p>A merchant submitted a Sham Cash transfer for review.</p>`
        + `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">${body}</table>`
        + `<p style="color:#64748b;font-size:13px">Match the reference against the wallet statement, then grant the plan from the admin customer page. Recording the decision does not open the account by itself.</p>`;
}
