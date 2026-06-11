import { randomUUID } from 'crypto';
import { db } from '../../db';
import { users, adminAuditLogs } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { stripeService } from '../stripe';
import { paymentRequestService, type PaymentRequestRow } from '../paymentRequest';
import {
    topupService,
    type TopupPack,
    type TopupSource,
} from '../topup';
import { config } from '../../config';
import { AppError, NotFoundError, ValidationError } from '../../utils/errors';

/**
 * Admin Billing service — orchestrates the existing Stripe / payment-request /
 * top-up services. Holds no payment logic of its own; it composes those
 * services and writes the admin audit trail.
 */

export interface CreatePaymentRequestBody {
    amountCents: number;
    currency?: string;
    description?: string;
    topupPurchaseId?: string;
}

export interface CreatePaymentRequestResult {
    id: string;
    url: string;
    amountCents: number;
    currency: string;
}

export interface CreditTopupBody {
    userId: string;
    pack: TopupPack;
    source?: Exclude<TopupSource, 'stripe'>;
    externalRef?: string;
    note?: string;
    force?: boolean;
}

/** Returned when an in-flight Stripe top-up blocks a manual credit (HTTP 409). */
export interface TopupBlockedResult {
    blocked: true;
    pendingPaymentIntentIds: string[];
}

export interface TopupCreditedResult {
    blocked: false;
    purchaseId: string;
    pack: TopupPack;
    repliesAdded: number;
    newBalance: number;
    /** PaymentIntents auto-canceled by the self-heal guard, for the caller to log. */
    cleared: string[];
}

export type CreditTopupResult = TopupBlockedResult | TopupCreditedResult;

class AdminBillingService {
    /**
     * Generate a hosted Stripe Checkout link for a custom amount and persist the
     * payment-request row + audit log. Throws AppError subclasses for the unhappy
     * paths (404 user, 400 no email, 502 no Stripe URL) so the controller maps
     * status codes exactly.
     */
    async createPaymentRequest(
        userId: string,
        body: CreatePaymentRequestBody,
        adminUserId: string | undefined,
    ): Promise<CreatePaymentRequestResult> {
        const { amountCents, currency = 'usd', description, topupPurchaseId } = body;

        const [user] = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) {
            throw new NotFoundError('User not found');
        }
        if (!user.email) {
            throw new ValidationError('User has no email on file — Stripe Checkout requires one');
        }

        // Mint the row id up front so it is BOTH the Stripe idempotency key AND
        // the session metadata paymentRequestId (metadata id === row id).
        const paymentRequestId = randomUUID();
        const normalizedCurrency = currency.toLowerCase();
        const session = await stripeService.createManualPaymentSession({
            userId,
            userEmail: user.email,
            amountCents,
            currency: normalizedCurrency,
            description: description ?? '',
            paymentRequestId,
            successUrl: `${config.frontendUrl}/payment/return?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${config.frontendUrl}/payment/return?canceled=1`,
        });

        if (!session.url) {
            throw new AppError('Stripe did not return a payment URL', 502, 'STRIPE_NO_URL');
        }

        const row = await paymentRequestService.create({
            id: paymentRequestId,
            userId,
            amountCents,
            currency: normalizedCurrency,
            description,
            stripeCheckoutSessionId: session.id,
            createdByAdminUserId: adminUserId ?? null,
            topupPurchaseId: topupPurchaseId ?? null,
        });

        await db.insert(adminAuditLogs).values({
            adminUserId,
            targetUserId: userId,
            action: 'payment_request_created',
            previousValue: null,
            newValue: {
                paymentRequestId: row.id,
                amountCents,
                currency: normalizedCurrency,
                description: description ?? null,
                stripeCheckoutSessionId: session.id,
                topupPurchaseId: topupPurchaseId ?? null,
            },
            note: description ?? null,
        });

        return { id: row.id, url: session.url, amountCents, currency: normalizedCurrency };
    }

    /** History of collect-payment links for a customer. */
    async listPaymentRequests(userId: string): Promise<PaymentRequestRow[]> {
        return paymentRequestService.listForUser(userId);
    }

    /**
     * Run the pending-Stripe-top-up guard (unless forced). Returns the cleared
     * (auto-canceled) PaymentIntents so the controller can audit-log them, and
     * the blocking ones if a credit must be refused. Does NOT itself credit.
     */
    async resolvePendingGuard(userId: string, force: boolean): Promise<{ blocking: string[]; cleared: string[] }> {
        if (force) {
            return { blocking: [], cleared: [] };
        }
        return topupService.resolvePendingStripeTopupsForCredit(userId);
    }

    /** Audit-log the auto-cancellation of abandoned pending Stripe top-ups. */
    async auditClearedPending(userId: string, adminUserId: string | undefined, cleared: string[]): Promise<void> {
        await db.insert(adminAuditLogs).values({
            adminUserId,
            targetUserId: userId,
            action: 'topup_pending_cancelled',
            previousValue: null,
            newValue: { canceledPaymentIntentIds: cleared },
            paymentReference: null,
            note: 'Abandoned Stripe top-up checkout(s) canceled while crediting manually',
        });
    }

    /** Credit a manual top-up pack and write the manual_topup audit log. */
    async creditManualTopup(
        body: CreditTopupBody,
        adminUserId: string | undefined,
    ): Promise<{ purchaseId: string; pack: TopupPack; repliesAdded: number; newBalance: number }> {
        const { userId, pack, source = 'manual', externalRef, note } = body;

        const result = await topupService.creditTopup({ userId, pack, source, externalRef });

        await db.insert(adminAuditLogs).values({
            adminUserId,
            targetUserId: userId,
            action: 'manual_topup',
            previousValue: null,
            newValue: {
                pack,
                repliesAdded: result.repliesAdded,
                source,
                newBalance: result.newBalance,
                purchaseId: result.purchaseId,
            },
            paymentReference: externalRef ?? null,
            note: note ?? null,
        });

        return { purchaseId: result.purchaseId, pack, repliesAdded: result.repliesAdded, newBalance: result.newBalance };
    }
}

export const adminBillingService = new AdminBillingService();
