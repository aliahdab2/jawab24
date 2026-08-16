import { FastifyRequest, FastifyReply } from 'fastify';
import { isAllowedAiModel } from '@jawab24/shared';
import { clearAiModelCache } from '../services/aiModelResolver';
import { AuthenticatedRequest } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { parsePaginationQuery } from '../utils/pagination';
import { SendEmailSchema, SendMerchantEmailSchema, sendMerchantEmailErrorCode } from '../utils/validation';
import {
    adminUsersService,
    adminSubscriptionsService,
    adminBillingService,
    adminKbService,
    adminWaitlistService,
    adminMetricsService,
    adminPartnersService,
    AI_COST_PERIODS,
    TooManyRecipientsError,
    UnknownTemplateError,
} from '../services/admin';
import {
    TopupUserNotFoundError,
    UnknownTopupPackError,
    DuplicateTopupError,
} from '../services/topup';
import { paymentsService, PaymentValidationError } from '../services/payments';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { AdminUserAiCostPeriod } from '../services/analytics';
import { getActivationFunnel } from '../services/activation';
import { businessAuditService } from '../services/businessAudit';
import type {
    ManualUpgradeBody,
    SearchUsersQuery,
    ListAllUsersQuery,
    AiModelBody,
    AiCostQuery,
    AiCreditBalanceBody,
    ActivationFunnelQuery,
    PaymentRequestBody,
    AdminRecordPaymentBody,
    KbUpdateBody,
    ReIngestBody,
    WaitlistListQuery,
    LeadDigestHistoryQuery,
    TopupBody,
    PlaygroundRequestBody,
    CreatePartnerBody,
    UpdatePartnerBody,
    AssignPartnerBody,
} from '../types/admin';

/**
 * Admin Controller — HTTP concerns only for the admin endpoints.
 *
 * Parses requests, delegates to the admin services, sets status codes, and maps
 * thrown domain errors to the exact response shapes the existing tests assert.
 * Business logic lives in src/services/admin/*.
 */
/** Validate the `period` querystring against the allowed presets; default 30d. */
function resolveAiCostPeriod(periodParam: string | undefined): AdminUserAiCostPeriod {
    return periodParam && (AI_COST_PERIODS as readonly string[]).includes(periodParam)
        ? periodParam as AdminUserAiCostPeriod
        : '30d';
}

export class AdminController {
    // ============================================
    // Users
    // ============================================

    /** GET /admin/users/all */
    async listAllUsers(request: FastifyRequest<{ Querystring: ListAllUsersQuery }>, reply: FastifyReply) {
        const { page, limit, status, plan: planSlug, search } = request.query;
        const { pageNum, limitNum, offset } = parsePaginationQuery(page, limit);

        try {
            const { data, total } = await adminUsersService.listAll({
                pageNum, limitNum, offset, status, planSlug, search,
            });

            return reply.send({
                success: true,
                data,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages: Math.ceil(total / limitNum),
                },
            });
        } catch (error) {
            request.log.error(error, 'Admin list all users failed');
            return reply.status(500).send({ success: false, error: 'Failed to list users' });
        }
    }

    /** GET /admin/users */
    async searchUsers(request: FastifyRequest<{ Querystring: SearchUsersQuery }>, reply: FastifyReply) {
        const { email } = request.query;

        if (!email || email.trim().length < 3) {
            return reply.status(400).send({
                success: false,
                error: 'Email query required (min 3 characters)',
            });
        }

        try {
            const data = await adminUsersService.searchByEmail(email);
            return reply.send({ success: true, data, count: data.length });
        } catch (error) {
            request.log.error(error, 'Admin user search failed');
            return reply.status(500).send({ success: false, error: 'Failed to search users' });
        }
    }

    /** GET /admin/users/:userId */
    async getUser(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
        const { userId } = request.params;

        try {
            const data = await adminUsersService.getUserDetail(userId);
            if (!data) {
                return reply.status(404).send({ success: false, error: 'User not found' });
            }
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin get user failed');
            return reply.status(500).send({ success: false, error: 'Failed to get user' });
        }
    }

    /** PATCH /admin/users/:userId/ai-model */
    async setAiModel(request: FastifyRequest<{ Params: { userId: string }; Body: AiModelBody }>, reply: FastifyReply) {
        const { userId } = request.params;
        const { model } = request.body;
        const adminUserId = (request as AuthenticatedRequest).user?.userId;

        if (model !== null && !isAllowedAiModel(model)) {
            return reply.status(400).send({ success: false, error: 'Invalid model' });
        }

        try {
            const { previousModel } = await adminUsersService.setAiModel(userId, model, adminUserId);

            // Cache invalidation lives outside the transaction: if the DB write
            // rolled back we never get here, so we won't wrongly evict.
            clearAiModelCache(userId);

            request.log.info({ adminUserId, targetUserId: userId, from: previousModel, to: model }, 'Admin changed AI model');

            return reply.send({ success: true, data: { aiModel: model } });
        } catch (error) {
            if (error instanceof AppError && error.statusCode === 404) {
                return reply.status(404).send({ success: false, error: 'User not found' });
            }
            request.log.error(error, 'Admin set AI model failed');
            return reply.status(500).send({ success: false, error: 'Failed to set AI model' });
        }
    }

    /** GET /admin/users/:userId/ai-cost */
    async getUserAiCost(request: FastifyRequest<{ Params: { userId: string }; Querystring: AiCostQuery }>, reply: FastifyReply) {
        const { userId } = request.params;
        const period = resolveAiCostPeriod(request.query.period);

        try {
            const data = await adminMetricsService.getUserAiCost(userId, period);
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin get user AI cost failed');
            return reply.status(500).send({ success: false, error: 'Failed to get AI cost' });
        }
    }

    /** GET /admin/ai-cost/consumption — global consumption + caching across all workspaces. */
    async getGlobalAiCost(request: FastifyRequest<{ Querystring: AiCostQuery }>, reply: FastifyReply) {
        const period = resolveAiCostPeriod(request.query.period);

        try {
            const data = await adminMetricsService.getGlobalAiCost(period);
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin get global AI cost failed');
            return reply.status(500).send({ success: false, error: 'Failed to get AI cost' });
        }
    }

    /** GET /admin/ai-cost/billing — authoritative OpenAI billing from snapshots. */
    async getAiBilling(request: FastifyRequest<{ Querystring: AiCostQuery }>, reply: FastifyReply) {
        const period = resolveAiCostPeriod(request.query.period);
        try {
            const data = await adminMetricsService.getAiBilling(period);
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin get AI billing failed');
            return reply.status(500).send({ success: false, error: 'Failed to get AI billing' });
        }
    }

    /** GET /admin/ai-cost/reconciliation — OpenAI prod-key vs our estimate + org total. */
    async getAiReconciliation(request: FastifyRequest<{ Querystring: AiCostQuery }>, reply: FastifyReply) {
        const period = resolveAiCostPeriod(request.query.period);
        try {
            const data = await adminMetricsService.getAiReconciliation(period);
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin get AI reconciliation failed');
            return reply.status(500).send({ success: false, error: 'Failed to get AI reconciliation' });
        }
    }

    /** GET /admin/ai-cost/runway — OpenAI credit runway + early-warning severity. */
    async getAiRunway(request: FastifyRequest, reply: FastifyReply) {
        try {
            const data = await adminMetricsService.getAiRunway();
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin get AI runway failed');
            return reply.status(500).send({ success: false, error: 'Failed to get AI runway' });
        }
    }

    /** PUT /admin/ai-cost/balance — set the OpenAI credit-balance anchor. */
    async setAiCreditBalance(request: FastifyRequest<{ Body: AiCreditBalanceBody }>, reply: FastifyReply) {
        const { balanceUsd, anchoredAt, note } = request.body;
        const updatedBy = (request as AuthenticatedRequest).user?.userId;
        try {
            const data = await adminMetricsService.setAiCreditBalance({ balanceUsd, anchoredAt, note, updatedBy });
            request.log.info({ adminUserId: updatedBy, balanceUsd, anchoredAt }, 'Admin set OpenAI credit balance anchor');
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin set AI credit balance failed');
            return reply.status(500).send({ success: false, error: 'Failed to set credit balance' });
        }
    }

    /** POST /admin/ai-cost/sync — on-demand OpenAI cost sync (admin "Sync now"). */
    async syncAiCosts(request: FastifyRequest, reply: FastifyReply) {
        try {
            const data = await adminMetricsService.syncOpenAiCosts();
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin AI cost sync failed');
            return reply.status(500).send({ success: false, error: 'Failed to sync AI costs' });
        }
    }

    /** POST /admin/users/:userId/upgrade */
    async manualUpgrade(request: FastifyRequest<{ Params: { userId: string }; Body: ManualUpgradeBody }>, reply: FastifyReply) {
        const { userId } = request.params;
        const { planId, periodMonths, paymentMethod } = request.body;
        const adminUserId = (request as AuthenticatedRequest).user?.userId;

        if (!planId || !periodMonths || !paymentMethod) {
            return reply.status(400).send({
                success: false,
                error: 'planId, periodMonths, and paymentMethod are required',
            });
        }

        if (![1, 3, 6, 12].includes(periodMonths)) {
            return reply.status(400).send({
                success: false,
                error: 'periodMonths must be 1, 3, 6, or 12',
            });
        }

        try {
            const result = await adminSubscriptionsService.manualUpgrade(userId, request.body, adminUserId);

            request.log.info(
                {
                    adminUserId,
                    targetUserId: userId,
                    planId,
                    periodMonths,
                    paymentMethod,
                    paymentReference: request.body.paymentReference,
                },
                'Manual subscription upgrade completed',
            );

            return reply.send({
                success: true,
                message: `User upgraded to ${result.plan.name} for ${periodMonths} month(s)`,
                data: {
                    subscription: result.subscription,
                    plan: result.plan,
                    periodEnd: result.periodEnd,
                },
            });
        } catch (error) {
            if (error instanceof AppError && error.statusCode === 404) {
                return reply.status(404).send({ success: false, error: error.message });
            }
            request.log.error(error, 'Admin manual upgrade failed');
            return reply.status(500).send({ success: false, error: 'Failed to upgrade user' });
        }
    }

    // ============================================
    // Billing — payment requests + top-up
    // ============================================

    /** POST /admin/users/:userId/payment-request */
    async createPaymentRequest(
        request: FastifyRequest<{ Params: { userId: string }; Body: PaymentRequestBody }>,
        reply: FastifyReply,
    ) {
        const { userId } = request.params;
        const adminUserId = (request as AuthenticatedRequest).user?.userId;

        try {
            const result = await adminBillingService.createPaymentRequest(userId, request.body, adminUserId);

            request.log.info(
                { adminUserId, targetUserId: userId, paymentRequestId: result.id, amountCents: result.amountCents, currency: result.currency },
                'Admin payment request created',
            );

            return reply.send({ success: true, data: result });
        } catch (error) {
            if (error instanceof AppError && error.statusCode !== 500) {
                return reply.status(error.statusCode).send({ success: false, error: error.message });
            }
            request.log.error(error, 'Admin payment request creation failed');
            return reply.status(500).send({ success: false, error: 'Failed to create payment request' });
        }
    }

    /** POST /admin/users/:userId/send-email — admin-composed account notice to one merchant. */
    async sendUserEmail(
        request: FastifyRequest<{ Params: { userId: string } }>,
        reply: FastifyReply,
    ) {
        const parsed = SendMerchantEmailSchema.safeParse(request.body);
        if (!parsed.success) {
            const issue = parsed.error.errors[0];
            // `code` is the stable contract the modal maps to its translated
            // messages; the English `error` string is diagnostic only. Additive
            // and backwards-compatible.
            return reply.status(400).send({
                success: false,
                error: issue?.message ?? 'Invalid request',
                code: issue ? sendMerchantEmailErrorCode(issue) : 'EMAIL_FIELDS_INVALID',
            });
        }

        const { userId } = request.params;
        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        if (!adminUserId) {
            return reply.status(401).send({ success: false, error: 'Unauthorized' });
        }

        try {
            const result = await adminUsersService.sendMerchantEmail(userId, parsed.data, adminUserId);
            request.log.info(
                { adminUserId, targetUserId: userId, emailSendId: result.emailSendId },
                'Admin sent merchant email',
            );
            return reply.send({ success: true, data: result });
        } catch (error) {
            if (error instanceof AppError && error.statusCode !== 500) {
                return reply.status(error.statusCode).send({ success: false, error: error.message });
            }
            request.log.error(error, 'Admin merchant email send failed');
            return reply.status(500).send({ success: false, error: 'Failed to send email' });
        }
    }

    /** GET /admin/users/:userId/payment-requests */
    async listPaymentRequests(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
        const { userId } = request.params;
        try {
            const data = await adminBillingService.listPaymentRequests(userId);
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin payment request list failed');
            return reply.status(500).send({ success: false, error: 'Failed to list payment requests' });
        }
    }

    /** GET /admin/users/:userId/payments — the merchant's full ledger. */
    async listPayments(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
        try {
            const data = await paymentsService.listForMerchant(request.params.userId);
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin payment list failed');
            return reply.status(500).send({ success: false, error: 'Failed to list payments' });
        }
    }

    /**
     * POST /admin/users/:userId/payments — record money we received.
     *
     * `collectedByPartner` decides whether this is an outstanding rep debt or
     * money already in hand; the partner it is attributed to comes from
     * `users.partner_id`, never from the body — an admin recording Ahmad's cash
     * should not have to know a partner uuid, and a mistyped one would credit
     * the wrong rep's payout.
     */
    async recordPayment(
        request: FastifyRequest<{ Params: { userId: string }; Body: AdminRecordPaymentBody }>,
        reply: FastifyReply,
    ) {
        const { userId } = request.params;
        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        if (!adminUserId) {
            return reply.status(401).send({ success: false, error: 'Authentication required' });
        }

        try {
            const body = request.body;
            const [merchant] = await db
                .select({ id: users.id, partnerId: users.partnerId })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);
            if (!merchant) {
                return reply.status(404).send({ success: false, error: 'User not found' });
            }

            const collectedByPartner = Boolean(body.collectedByPartner && merchant.partnerId);
            const payment = await paymentsService.record(
                {
                    userId,
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
                {
                    userId: adminUserId,
                    collectedBy: collectedByPartner ? 'partner' : 'admin',
                    // Attribute to the merchant's rep whenever there is one, so
                    // a direct admin collection still counts toward that rep's
                    // book — it is his merchant either way.
                    partnerId: merchant.partnerId ?? null,
                },
            );

            request.log.info(
                { adminUserId, targetUserId: userId, paymentId: payment.id, amountCents: payment.amountCents },
                'Admin payment recorded',
            );
            return reply.status(201).send({ success: true, data: payment });
        } catch (error) {
            if (error instanceof PaymentValidationError) {
                return reply.status(400).send({ success: false, error: error.message, code: error.code });
            }
            request.log.error(error, 'Admin payment record failed');
            return reply.status(500).send({ success: false, error: 'Failed to record payment' });
        }
    }

    /** POST /admin/payments/:paymentId/settle */
    async settlePayment(request: FastifyRequest<{ Params: { paymentId: string } }>, reply: FastifyReply) {
        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        if (!adminUserId) {
            return reply.status(401).send({ success: false, error: 'Authentication required' });
        }
        try {
            const updated = await paymentsService.settle(request.params.paymentId, adminUserId);
            // Null means the row is missing or is no longer 'recorded' — a
            // replayed click, not an error worth a 500.
            if (!updated) {
                return reply.status(409).send({ success: false, error: 'Payment is not awaiting settlement' });
            }
            return reply.send({ success: true, data: updated });
        } catch (error) {
            request.log.error(error, 'Admin payment settle failed');
            return reply.status(500).send({ success: false, error: 'Failed to settle payment' });
        }
    }

    /** POST /admin/payments/:paymentId/void */
    async voidPayment(
        request: FastifyRequest<{ Params: { paymentId: string }; Body: { reason: string } }>,
        reply: FastifyReply,
    ) {
        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        if (!adminUserId) {
            return reply.status(401).send({ success: false, error: 'Authentication required' });
        }
        try {
            const updated = await paymentsService.void(request.params.paymentId, adminUserId, request.body.reason);
            if (!updated) {
                return reply.status(409).send({ success: false, error: 'Payment not found or already void' });
            }
            return reply.send({ success: true, data: updated });
        } catch (error) {
            request.log.error(error, 'Admin payment void failed');
            return reply.status(500).send({ success: false, error: 'Failed to void payment' });
        }
    }

    /** GET /admin/partners/outstanding — what each rep still owes us. */
    async partnerOutstanding(request: FastifyRequest, reply: FastifyReply) {
        try {
            const data = await paymentsService.outstandingByPartner();
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin partner outstanding failed');
            return reply.status(500).send({ success: false, error: 'Failed to load outstanding totals' });
        }
    }

    /** POST /admin/topup */
    async creditTopup(request: FastifyRequest<{ Body: TopupBody }>, reply: FastifyReply) {
        const { userId, pack, source = 'manual', externalRef, note, force = false } = request.body;
        const adminUserId = (request as AuthenticatedRequest).user?.userId;

        // Guard against double-crediting a Stripe top-up whose money could still be
        // captured. force=true skips the guard entirely (explicit operator override).
        if (!force) {
            const { blocking, cleared } = await adminBillingService.resolvePendingGuard(userId, false);
            // The guard cancels abandoned checkouts as a side effect — record it
            // (structured log + audit trail) so a canceled customer PaymentIntent
            // is always traceable to this action.
            if (cleared.length > 0) {
                request.log.info(
                    { userId, adminUserId, canceledPaymentIntentIds: cleared },
                    'manual_topup guard: auto-canceled abandoned pending Stripe top-up(s)',
                );
                await adminBillingService.auditClearedPending(userId, adminUserId, cleared);
            }
            if (blocking.length > 0) {
                return reply.status(409).send({
                    success: false,
                    error: 'PENDING_STRIPE_TOPUP',
                    message: `User has ${blocking.length} in-flight Stripe top-up(s) that may still complete and credit automatically — manual crediting now risks a double-credit. Resend with force=true only if this credit is unrelated to those payments.`,
                    pendingPaymentIntentIds: blocking,
                });
            }
        } else {
            request.log.warn(
                { userId, adminUserId, pack },
                'manual_topup forced past the pending-Stripe-top-up guard',
            );
        }

        try {
            const result = await adminBillingService.creditManualTopup(
                { userId, pack, source, externalRef, note, force },
                adminUserId,
            );

            return reply.send({
                success: true,
                purchase: {
                    id: result.purchaseId,
                    pack: result.pack,
                    repliesAdded: result.repliesAdded,
                },
                newBalance: result.newBalance,
            });
        } catch (err) {
            if (err instanceof TopupUserNotFoundError) {
                return reply.status(404).send({ success: false, error: 'User not found' });
            }
            if (err instanceof UnknownTopupPackError) {
                return reply.status(400).send({ success: false, error: err.message });
            }
            if (err instanceof DuplicateTopupError) {
                // Shouldn't fire for manual/admin (no PaymentIntent id), but defensive.
                return reply.status(409).send({ success: false, error: 'Duplicate purchase' });
            }
            request.log.error(err, 'manual_topup failed');
            return reply.status(500).send({ success: false, error: 'Top-up credit failed' });
        }
    }

    // ============================================
    // Plans + audit logs
    // ============================================

    /** GET /admin/plans */
    async listPlans(request: FastifyRequest, reply: FastifyReply) {
        try {
            const data = await adminMetricsService.listPlans();
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin get plans failed');
            return reply.status(500).send({ success: false, error: 'Failed to get plans' });
        }
    }

    /** GET /admin/audit-logs */
    async listAuditLogs(request: FastifyRequest, reply: FastifyReply) {
        try {
            const data = await adminMetricsService.listAuditLogs();
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin get audit logs failed');
            return reply.status(500).send({ success: false, error: 'Failed to get audit logs' });
        }
    }

    // ============================================
    // Partners (resellers / country reps)
    // ============================================

    /** GET /admin/partners */
    async listPartners(request: FastifyRequest, reply: FastifyReply) {
        try {
            const data = await adminPartnersService.list();
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin list partners failed');
            return reply.status(500).send({ success: false, error: 'Failed to list partners' });
        }
    }

    /** POST /admin/partners */
    async createPartner(request: FastifyRequest<{ Body: CreatePartnerBody }>, reply: FastifyReply) {
        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        try {
            const data = await adminPartnersService.create(request.body, adminUserId);
            return reply.status(201).send({ success: true, data });
        } catch (error) {
            if (error instanceof AppError) {
                return reply.status(error.statusCode).send({ success: false, error: error.message });
            }
            request.log.error(error, 'Admin create partner failed');
            return reply.status(500).send({ success: false, error: 'Failed to create partner' });
        }
    }

    /**
     * PUT /admin/partners/:partnerId — update contact/commission/active state,
     * and link (`userId`) or unbind (`userId: null`) the portal login.
     */
    async updatePartner(
        request: FastifyRequest<{ Params: { partnerId: string }; Body: UpdatePartnerBody }>,
        reply: FastifyReply,
    ) {
        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        try {
            const data = await adminPartnersService.update(request.params.partnerId, request.body, adminUserId);
            return reply.send({ success: true, data });
        } catch (error) {
            if (error instanceof AppError) {
                return reply.status(error.statusCode).send({ success: false, error: error.message });
            }
            request.log.error(error, 'Admin update partner failed');
            return reply.status(500).send({ success: false, error: 'Failed to update partner' });
        }
    }

    /** PUT /admin/users/:userId/partner — assign or clear (partnerId: null) attribution. */
    async assignUserPartner(
        request: FastifyRequest<{ Params: { userId: string }; Body: AssignPartnerBody }>,
        reply: FastifyReply,
    ) {
        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        try {
            const data = await adminPartnersService.assignToUser(
                request.params.userId,
                request.body.partnerId,
                adminUserId,
                request.body.note,
            );
            return reply.send({ success: true, data });
        } catch (error) {
            if (error instanceof AppError) {
                return reply.status(error.statusCode).send({ success: false, error: error.message });
            }
            request.log.error(error, 'Admin assign partner failed');
            return reply.status(500).send({ success: false, error: 'Failed to assign partner' });
        }
    }

    /** GET /admin/activation-funnel?days=30 — signup → first-auto-reply funnel. */
    async getActivationFunnel(request: FastifyRequest<{ Querystring: ActivationFunnelQuery }>, reply: FastifyReply) {
        // Fastify coerces the querystring to a number via the route schema; clamp
        // defensively to a sane window (1–365 days) regardless of input.
        const raw = Number(request.query.days);
        const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.trunc(raw))) : 30;
        try {
            const data = await getActivationFunnel(days);
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin activation funnel failed');
            return reply.status(500).send({ success: false, error: 'Failed to get activation funnel' });
        }
    }

    // ============================================
    // KB / AI playground
    // ============================================

    /** GET /admin/pages */
    async listPages(request: FastifyRequest, reply: FastifyReply) {
        try {
            const data = await adminKbService.listPagesForPlayground();
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin list pages failed');
            return reply.status(500).send({ success: false, error: 'Failed to list pages' });
        }
    }

    /** GET /admin/kb/status/:pageId */
    async getKbStatus(request: FastifyRequest<{ Params: { pageId: string } }>, reply: FastifyReply) {
        const { pageId } = request.params;
        try {
            const data = await adminKbService.getStatus(pageId);
            if (!data) {
                return reply.status(404).send({ success: false, error: 'Page not found' });
            }
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin KB status failed');
            return reply.status(500).send({ success: false, error: 'Failed to get KB status' });
        }
    }

    /** GET /admin/kb/gaps/:pageId */
    async getKbGaps(request: FastifyRequest<{ Params: { pageId: string } }>, reply: FastifyReply) {
        const { pageId } = request.params;
        try {
            const data = await adminKbService.listGaps(pageId);
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin KB gaps failed');
            return reply.status(500).send({ success: false, error: 'Failed to get KB gaps' });
        }
    }

    /**
     * POST /admin/kb/audit/:pageId
     *
     * Run the Business Info audit on any page, across workspaces. Read-only:
     * no KB write, no re-ingestion, no merchant notification. Shares the
     * merchant-facing service AND its cache, so the founder sees exactly the
     * findings the merchant would see — a divergence here would make the
     * panel useless for support.
     */
    async auditBusinessInfo(request: FastifyRequest<{ Params: { pageId: string } }>, reply: FastifyReply) {
        const { pageId } = request.params;
        try {
            const data = await businessAuditService.run(pageId, request.log);
            if (!data) {
                return reply.status(404).send({ success: false, error: 'Page not found' });
            }
            return reply.send({ success: true, data });
        } catch (error) {
            request.log.error(error, 'Admin Business Info audit failed');
            return reply.status(500).send({ success: false, error: 'Failed to audit Business Info' });
        }
    }

    /** PATCH /admin/pages/:pageId/kb */
    async updateKb(request: FastifyRequest<{ Params: { pageId: string }; Body: KbUpdateBody }>, reply: FastifyReply) {
        const { pageId } = request.params;
        const { knowledgeBase } = request.body;

        if (typeof knowledgeBase !== 'string') {
            return reply.status(400).send({ success: false, error: 'knowledgeBase (string) is required' });
        }

        try {
            const data = await adminKbService.updateKb(pageId, knowledgeBase, request.log);
            return reply.send({ success: true, data });
        } catch (error) {
            if (error instanceof AppError && error.statusCode === 404) {
                return reply.status(404).send({ success: false, error: 'Page not found' });
            }
            request.log.error(error, 'Admin KB update failed');
            return reply.status(500).send({ success: false, error: 'Failed to update KB' });
        }
    }

    /** POST /admin/kb/re-ingest */
    async reIngestKb(request: FastifyRequest<{ Body: ReIngestBody }>, reply: FastifyReply) {
        try {
            const data = await adminKbService.reIngest(request.body?.pageId, request.log);
            return reply.send({ success: true, data });
        } catch (error) {
            if (error instanceof AppError && error.statusCode === 503) {
                return reply.status(503).send({ success: false, error: 'Ingestion service unavailable (no OpenAI key)' });
            }
            request.log.error(error, 'KB re-ingestion failed');
            return reply.status(500).send({ success: false, error: 'Failed to re-ingest KB' });
        }
    }

    /** POST /admin/ai/playground */
    async runPlayground(request: FastifyRequest<{ Body: PlaygroundRequestBody }>, reply: FastifyReply) {
        try {
            const { reply: generated, latencyMs, commentReplyMode, nudgeText } =
                await adminKbService.runPlayground(request.body, request.log);

            return reply.send({
                success: true,
                data: {
                    ...generated,
                    latencyMs,
                    commentReplyMode,
                    nudgeText,
                },
            });
        } catch (error) {
            if (error instanceof AppError && error.statusCode === 400) {
                return reply.status(400).send({ success: false, error: 'pageId and question are required' });
            }
            if (error instanceof AppError && error.statusCode === 404) {
                return reply.status(404).send({ success: false, error: 'Page not found' });
            }
            request.log.error(error, 'Admin AI playground failed');
            return reply.status(500).send({ success: false, error: 'Failed to generate AI reply' });
        }
    }

    // ============================================
    // Waitlist / broadcast email
    // ============================================

    /** GET /admin/waitlist */
    async listWaitlist(request: FastifyRequest<{ Querystring: WaitlistListQuery }>, reply: FastifyReply) {
        const { page, limit, feature, search } = request.query;
        const { pageNum, limitNum, offset } = parsePaginationQuery(page, limit);

        try {
            const result = await adminWaitlistService.list({ limitNum, offset, feature, search });

            return reply.send({
                success: true,
                data: result.data,
                features: result.features,
                emailCount: result.emailCount,
                phoneOnlyCount: result.phoneOnlyCount,
                userEmailCount: result.userEmailCount,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: result.total,
                    totalPages: Math.ceil(result.total / limitNum),
                },
            });
        } catch (error) {
            request.log.error(error, 'Failed to list waitlist entries');
            return reply.status(500).send({ success: false, error: 'Failed to load waitlist' });
        }
    }

    /** POST /admin/waitlist/send-email */
    async sendWaitlistEmail(request: FastifyRequest, reply: FastifyReply) {
        const parsed = SendEmailSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                success: false,
                error: parsed.error.errors[0]?.message ?? 'Invalid request',
            });
        }

        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        if (!adminUserId) {
            return reply.status(401).send({ success: false, error: 'Unauthorized' });
        }

        try {
            const result = await adminWaitlistService.sendEmail(parsed.data, adminUserId, request.log);
            return reply.send({ success: true, ...result });
        } catch (error) {
            if (error instanceof UnknownTemplateError || error instanceof TooManyRecipientsError) {
                return reply.status(400).send({ success: false, error: error.message });
            }
            request.log.error(error, 'Failed to send waitlist emails');
            return reply.status(500).send({ success: false, error: 'Failed to send emails' });
        }
    }

    /** GET /admin/waitlist/templates */
    async listWaitlistTemplates(_request: FastifyRequest, reply: FastifyReply) {
        return reply.send({ success: true, templates: adminWaitlistService.listTemplates() });
    }

    // ============================================
    // Lead digest + emails
    // ============================================

    /** GET /admin/lead-digest/history */
    async listLeadDigestHistory(request: FastifyRequest<{ Querystring: LeadDigestHistoryQuery }>, reply: FastifyReply) {
        const { pageNum, limitNum, offset } = parsePaginationQuery(request.query.page, request.query.limit, 50, 200);
        const statusFilter = request.query.status?.trim();

        const rows = await adminMetricsService.listLeadDigestHistory({ limit: limitNum, offset, status: statusFilter });
        return reply.send({ page: pageNum, limit: limitNum, rows });
    }

    /** POST /admin/lead-digest/run */
    async runLeadDigest(request: FastifyRequest, reply: FastifyReply) {
        try {
            const result = await adminMetricsService.runLeadDigest();
            return reply.send(result);
        } catch (error) {
            request.log.error(error, 'Manual lead digest trigger failed');
            return reply.status(500).send({ success: false, error: 'Lead digest run failed' });
        }
    }

    /** GET /admin/emails/:id */
    async getEmail(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
        const row = await adminMetricsService.getEmail(request.params.id);
        if (!row) return reply.status(404).send({ error: 'Not found' });
        return reply.send(row);
    }
}

export const adminController = new AdminController();
