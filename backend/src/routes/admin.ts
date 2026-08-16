import { FastifyInstance } from 'fastify';
import { authenticate, requireAdmin } from '../middleware/auth';
import { auth } from '../utils/swagger';
import { adminController } from '../controllers/admin';
import { AI_COST_PERIODS } from '../services/admin';
import { sendMerchantEmailBodySchema } from './schemas/sendMerchantEmail';

/**
 * Admin Routes — Protected endpoints for manual subscription management,
 * billing, KB tooling, the AI playground, waitlist broadcasts, and metrics.
 *
 * Thin registration only: each handler delegates to AdminController. Business
 * logic lives in src/services/admin/*; HTTP concerns live in the controller.
 * All routes require authentication + admin privileges.
 */
export default async function adminRoutes(fastify: FastifyInstance) {
    fastify.register(async (adminProtected) => {
        adminProtected.addHook('preHandler', authenticate);
        adminProtected.addHook('preHandler', requireAdmin);

        // ============================================
        // Users
        // ============================================

        adminProtected.get(
            '/users/all',
            { schema: { tags: ['Admin'], summary: 'List all users with pagination and filters', security: auth } },
            adminController.listAllUsers,
        );

        adminProtected.get(
            '/users',
            { schema: { tags: ['Admin'], summary: 'Search users by email', security: auth } },
            adminController.searchUsers,
        );

        adminProtected.get(
            '/users/:userId',
            { schema: { tags: ['Admin'], summary: 'Get single user details with pages and usage', security: auth, params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] } } },
            adminController.getUser,
        );

        adminProtected.patch(
            '/users/:userId/ai-model',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Set or clear the per-workspace AI model override',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                    body: {
                        type: 'object',
                        properties: { model: { type: ['string', 'null'] } },
                        required: ['model'],
                    },
                },
            },
            adminController.setAiModel,
        );

        adminProtected.get(
            '/users/:userId/ai-cost',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'AI cost by page for a single user, scoped to a preset time period',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                    querystring: {
                        type: 'object',
                        properties: { period: { type: 'string', enum: [...AI_COST_PERIODS] } },
                    },
                },
            },
            adminController.getUserAiCost,
        );

        adminProtected.get(
            '/ai-cost/consumption',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Global AI consumption + caching across all workspaces, scoped to a preset period',
                    security: auth,
                    querystring: {
                        type: 'object',
                        properties: { period: { type: 'string', enum: [...AI_COST_PERIODS] } },
                    },
                },
            },
            adminController.getGlobalAiCost,
        );

        adminProtected.get(
            '/ai-cost/billing',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Authoritative OpenAI billing (from daily Costs-API snapshots), by month/model/api-key',
                    security: auth,
                    querystring: {
                        type: 'object',
                        properties: { period: { type: 'string', enum: [...AI_COST_PERIODS] } },
                    },
                },
            },
            adminController.getAiBilling,
        );

        adminProtected.get(
            '/ai-cost/reconciliation',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'OpenAI production-key spend vs our ai_usage_log estimate, with org total for context',
                    security: auth,
                    querystring: {
                        type: 'object',
                        properties: { period: { type: 'string', enum: [...AI_COST_PERIODS] } },
                    },
                },
            },
            adminController.getAiReconciliation,
        );

        adminProtected.get(
            '/ai-cost/runway',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'OpenAI credit runway + early-warning severity (org-total burn)',
                    security: auth,
                },
            },
            adminController.getAiRunway,
        );

        adminProtected.put(
            '/ai-cost/balance',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Set the OpenAI credit-balance anchor ("balance $X as of date Y")',
                    security: auth,
                    body: {
                        type: 'object',
                        required: ['balanceUsd', 'anchoredAt'],
                        properties: {
                            balanceUsd: { type: 'number', minimum: 0 },
                            anchoredAt: { type: 'string', format: 'date' },
                            note: { type: 'string', maxLength: 500 },
                        },
                    },
                },
            },
            adminController.setAiCreditBalance,
        );

        adminProtected.post(
            '/ai-cost/sync',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'On-demand OpenAI cost sync (pull Costs API → snapshots → re-evaluate runway)',
                    security: auth,
                },
            },
            adminController.syncAiCosts,
        );

        adminProtected.post(
            '/users/:userId/upgrade',
            { schema: { tags: ['Admin'], summary: 'Manual subscription upgrade for a user', security: auth, params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] } } },
            adminController.manualUpgrade,
        );

        // ============================================
        // Billing — payment requests + top-up
        // ============================================

        adminProtected.post(
            '/users/:userId/payment-request',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Generate a custom Stripe payment link to collect money for an already-granted credit',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                    body: {
                        type: 'object',
                        required: ['amountCents'],
                        properties: {
                            // Integer cents; positive. Upper bound mirrors Stripe's practical limit
                            // and guards against an accidental extra-zero fat-finger.
                            amountCents: { type: 'integer', minimum: 1, maximum: 99_999_99 },
                            currency: { type: 'string', minLength: 3, maxLength: 3, default: 'usd' },
                            description: { type: 'string', maxLength: 500 },
                            // Optional link to the manual top-up this collects money for.
                            topupPurchaseId: { type: 'string', format: 'uuid' },
                        },
                    },
                },
            },
            adminController.createPaymentRequest,
        );

        adminProtected.post(
            '/users/:userId/send-email',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Send an admin-composed account-notice email to one merchant',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                    // Shape + count/format rejection at the route layer; sizes,
                    // file types, magic bytes = Zod in the controller. The
                    // object is exported so its test registers the real thing.
                    body: sendMerchantEmailBodySchema,
                },
            },
            adminController.sendUserEmail,
        );

        adminProtected.get(
            '/users/:userId/payment-requests',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'List a customer\'s collect-payment requests',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                },
            },
            adminController.listPaymentRequests,
        );

        // ============================================
        // Payments ledger — every dollar received, however it arrived
        // ============================================

        adminProtected.get(
            '/users/:userId/payments',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'One merchant\'s payment ledger (all methods and collectors)',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                },
            },
            adminController.listPayments,
        );

        adminProtected.post(
            '/users/:userId/payments',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Record a payment received from a merchant (cash, Sham Cash, transfer, or off-Stripe)',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                    body: {
                        type: 'object',
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
                            // An admin recording a payment a REP collected must
                            // say so, or the money looks settled and drops out
                            // of what that rep still owes us.
                            collectedByPartner: { type: 'boolean' },
                        },
                    },
                },
            },
            adminController.recordPayment,
        );

        adminProtected.post(
            '/payments/:paymentId/settle',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Confirm a rep-collected payment reached us (تسليم المبلغ)',
                    security: auth,
                    params: { type: 'object', properties: { paymentId: { type: 'string', format: 'uuid' } }, required: ['paymentId'] },
                },
            },
            adminController.settlePayment,
        );

        adminProtected.post(
            '/payments/:paymentId/void',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Void a payment row (mistake, duplicate, bounced transfer) — kept, never deleted',
                    security: auth,
                    params: { type: 'object', properties: { paymentId: { type: 'string', format: 'uuid' } }, required: ['paymentId'] },
                    body: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['reason'],
                        properties: { reason: { type: 'string', minLength: 3, maxLength: 500 } },
                    },
                },
            },
            adminController.voidPayment,
        );

        adminProtected.get(
            '/partners/outstanding',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'What each reseller has collected but not yet handed over',
                    security: auth,
                },
            },
            adminController.partnerOutstanding,
        );

        adminProtected.post(
            '/topup',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Manually credit a top-up pack to a user',
                    security: auth,
                    body: {
                        type: 'object',
                        required: ['userId', 'pack'],
                        properties: {
                            userId: { type: 'string', format: 'uuid' },
                            pack: { type: 'string', enum: ['5k', '10k'] },
                            source: { type: 'string', enum: ['manual', 'admin'], default: 'manual' },
                            externalRef: { type: 'string', maxLength: 255 },
                            note: { type: 'string', maxLength: 1000 },
                            // Override the open-pending-Stripe-top-up guard below.
                            force: { type: 'boolean', default: false },
                        },
                    },
                },
            },
            adminController.creditTopup,
        );

        // ============================================
        // Partners (resellers / country reps)
        // ============================================

        adminProtected.get(
            '/partners',
            { schema: { tags: ['Admin'], summary: 'List partners (resellers) with merchant counts', security: auth } },
            adminController.listPartners,
        );

        adminProtected.post(
            '/partners',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Create a partner (reseller / country rep)',
                    security: auth,
                    body: {
                        type: 'object',
                        // email/phone are both optional HERE but the service
                        // requires at least one — they are the anchors the
                        // portal binds a login to, and which one applies
                        // depends on how the partner signs up (a phone-OTP
                        // signup never has an email).
                        required: ['name', 'commissionPct'],
                        properties: {
                            name: { type: 'string', minLength: 1, maxLength: 255 },
                            email: { type: ['string', 'null'], format: 'email', maxLength: 255 },
                            phone: { type: ['string', 'null'], pattern: '^\\+[1-9]\\d{6,18}$' },
                            commissionPct: { type: 'integer', minimum: 0, maximum: 100 },
                        },
                    },
                },
            },
            adminController.createPartner,
        );

        adminProtected.put(
            '/partners/:partnerId',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Update a partner: contact, commission, active state, or portal binding',
                    security: auth,
                    params: {
                        type: 'object',
                        properties: { partnerId: { type: 'string', format: 'uuid' } },
                        required: ['partnerId'],
                    },
                    body: {
                        type: 'object',
                        // Every field optional: omitted = unchanged.
                        properties: {
                            name: { type: 'string', minLength: 1, maxLength: 255 },
                            email: { type: ['string', 'null'], format: 'email', maxLength: 255 },
                            phone: { type: ['string', 'null'], pattern: '^\\+[1-9]\\d{6,18}$' },
                            commissionPct: { type: 'integer', minimum: 0, maximum: 100 },
                            // false = cut portal access on the next request.
                            isActive: { type: 'boolean' },
                            // null = unbind (recovery); a uuid = link an
                            // email-only partner who cannot auto-bind.
                            userId: { type: ['string', 'null'], format: 'uuid' },
                        },
                        additionalProperties: false,
                    },
                },
            },
            adminController.updatePartner,
        );

        adminProtected.put(
            '/users/:userId/partner',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Assign or clear a merchant\'s partner (reseller) attribution',
                    security: auth,
                    params: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' } }, required: ['userId'] },
                    body: {
                        type: 'object',
                        required: ['partnerId'],
                        properties: {
                            partnerId: { type: ['string', 'null'], format: 'uuid' },
                            // Partner-visible follow-up note. Omit = unchanged; null/'' = clear.
                            note: { type: ['string', 'null'], maxLength: 500 },
                        },
                    },
                },
            },
            adminController.assignUserPartner,
        );

        // ============================================
        // Plans + audit logs
        // ============================================

        adminProtected.get(
            '/plans',
            { schema: { tags: ['Admin'], summary: 'List all plans for admin dropdown', security: auth } },
            adminController.listPlans,
        );

        adminProtected.get(
            '/audit-logs',
            { schema: { tags: ['Admin'], summary: 'View recent audit logs', security: auth } },
            adminController.listAuditLogs,
        );

        adminProtected.get(
            '/activation-funnel',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Activation funnel (signup → first auto-reply) for the signup cohort in the window',
                    security: auth,
                    querystring: {
                        type: 'object',
                        properties: {
                            days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
                        },
                    },
                },
            },
            adminController.getActivationFunnel,
        );

        // ============================================
        // AI Playground — Admin-only reply testing
        // ============================================

        adminProtected.get(
            '/pages',
            { schema: { tags: ['Admin'], summary: 'List all pages for playground', security: auth } },
            adminController.listPages,
        );

        adminProtected.get(
            '/kb/status/:pageId',
            { schema: { tags: ['Admin'], summary: 'Get KB status for a page', security: auth } },
            adminController.getKbStatus,
        );

        adminProtected.get(
            '/kb/gaps/:pageId',
            { schema: { tags: ['Admin'], summary: 'List KB gaps for a page', security: auth } },
            adminController.getKbGaps,
        );

        adminProtected.post(
            '/kb/audit/:pageId',
            {
                schema: {
                    tags: ['Admin'],
                    summary: 'Audit a page\'s Business Info for instructions the AI cannot execute (read-only)',
                    security: auth,
                },
                // One pinned gpt-4.1-mini call per uncached KB. Bounded so a
                // stuck loop in the panel can't sweep every page's cost.
                config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
            },
            adminController.auditBusinessInfo,
        );

        adminProtected.patch(
            '/pages/:pageId/kb',
            { schema: { tags: ['Admin'], summary: 'Update KB text for a page and trigger re-ingestion', security: auth } },
            adminController.updateKb,
        );

        adminProtected.post(
            '/kb/re-ingest',
            { schema: { tags: ['Admin'], summary: 'Re-ingest KB chunks for all (or one) page', security: auth } },
            adminController.reIngestKb,
        );

        adminProtected.post(
            '/ai/playground',
            { schema: { tags: ['Admin'], summary: 'Test AI reply generation with full metadata', security: auth } },
            adminController.runPlayground,
        );

        // ============================================
        // Waitlist / broadcast email
        // ============================================

        adminProtected.get(
            '/waitlist',
            { schema: { tags: ['Admin'], summary: 'List waitlist signups', security: auth } },
            adminController.listWaitlist,
        );

        adminProtected.post(
            '/waitlist/send-email',
            { schema: { tags: ['Admin'], summary: 'Send email to waitlist subscribers', security: auth } },
            adminController.sendWaitlistEmail,
        );

        adminProtected.get(
            '/waitlist/templates',
            { schema: { tags: ['Admin'], summary: 'List reusable waitlist email templates', security: auth } },
            adminController.listWaitlistTemplates,
        );

        // ============================================
        // Lead digest + emails
        // ============================================

        adminProtected.get(
            '/lead-digest/history',
            {
                schema: {
                    description: 'Paginated history of lead digest sends/skips',
                    tags: ['Admin'],
                    security: auth,
                },
            },
            adminController.listLeadDigestHistory,
        );

        adminProtected.get(
            '/emails/:id',
            {
                schema: {
                    description: 'Fetch the rendered subject + html body for a single outbound email',
                    tags: ['Admin'],
                    security: auth,
                },
            },
            adminController.getEmail,
        );

        adminProtected.post(
            '/lead-digest/run',
            {
                schema: {
                    description: 'Manually run the daily lead digest job',
                    tags: ['Admin'],
                    security: auth,
                    response: {
                        200: {
                            type: 'object',
                            properties: {
                                processed: { type: 'number' },
                                sent: { type: 'number' },
                                skipped: { type: 'number' },
                                errors: { type: 'number' },
                            },
                        },
                    },
                },
            },
            adminController.runLeadDigest,
        );
    });
}
