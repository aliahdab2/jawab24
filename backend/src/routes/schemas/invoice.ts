/**
 * Fastify body schema shared by POST /admin/users/:userId/invoices and its
 * /preview sibling — the two take identical input, and only one of them
 * allocates a number.
 *
 * Same division of labour as sendMerchantEmail.ts: this layer is EARLY
 * REJECTION of shape violations plus the OpenAPI surface. It is not
 * documentation-only — deleting a constraint here removes a live refusal — but
 * `CreateInvoiceSchema` (Zod, in the controller) remains the authority, and is
 * the only layer that can express the cross-field rules (a period needs both
 * ends; the end must follow the start).
 *
 * Exported so the route test registers THIS object rather than a hand-kept copy
 * (AI_INSTRUCTIONS §19.3: tests import production predicates, never copy them).
 */

/** Ceiling shared with `invoiceCents` in utils/validation.ts: 1,000,000 USD in
 *  cents. A typo guard on hand-typed money, not a business limit. */
export const MAX_INVOICE_CENTS = 100_000_000;

export const invoiceBodySchema = {
    type: 'object',
    required: ['lang', 'customerName', 'lineDescription', 'quantityLabel', 'currency', 'subtotalCents', 'vatCents'],
    properties: {
        lang: { type: 'string', enum: ['ar', 'en'] },
        customerName: { type: 'string', minLength: 1, maxLength: 255 },
        customerContact: { type: 'string', maxLength: 255 },
        customerEmail: { type: 'string', format: 'email', maxLength: 255 },
        customerAddress: { type: 'string', maxLength: 1000 },
        lineDescription: { type: 'string', minLength: 1, maxLength: 500 },
        lineDetail: { type: 'string', maxLength: 1000 },
        quantityLabel: { type: 'string', minLength: 1, maxLength: 64 },
        periodStart: { type: 'string', format: 'date-time' },
        periodEnd: { type: 'string', format: 'date-time' },
        currency: { type: 'string', minLength: 3, maxLength: 3 },
        subtotalCents: { type: 'integer', minimum: 0, maximum: MAX_INVOICE_CENTS },
        vatCents: { type: 'integer', minimum: 0, maximum: MAX_INVOICE_CENTS },
        planId: { type: 'string', format: 'uuid' },
        paymentNote: { type: 'string', maxLength: 500 },
    },
} as const;
