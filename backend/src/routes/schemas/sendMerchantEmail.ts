import {
    MAX_EMAIL_ATTACHMENTS,
    MAX_EMAIL_CC,
} from '@jawab24/shared';

/**
 * Fastify body schema for POST /admin/users/:userId/send-email.
 *
 * The route layer's job here is EARLY REJECTION of shape violations — malformed
 * addresses (ajv-formats' `email`), over-count lists (`maxItems`) — plus the
 * OpenAPI surface. It is NOT documentation-only: deleting a constraint from
 * this object removes a live refusal. Sizes, file types, magic bytes and
 * control characters are enforced by SendMerchantEmailSchema (Zod) in the
 * controller, which remains the authority; both layers must refuse what they
 * can see. Route-layer rejections surface through the global errorHandler
 * shape ({ error: true, code: 'VALIDATION_ERROR', details }), NOT the
 * controller's { success: false } shape — a raw API consumer handling errors
 * needs to know both exist.
 *
 * Exported so sendMerchantEmailRouteSchema.test.ts registers THIS object, not
 * a hand-kept copy (§19.3: tests import production predicates, never copy
 * them). Counts come from @jawab24/shared so they cannot drift from the Zod
 * schema or the frontend pre-submit checks.
 */
export const sendMerchantEmailBodySchema = {
    type: 'object',
    required: ['subject', 'body'],
    properties: {
        subject: { type: 'string', minLength: 1, maxLength: 500 },
        body: { type: 'string', minLength: 1, maxLength: 20_000 },
        cc: { type: 'array', maxItems: MAX_EMAIL_CC, items: { type: 'string', format: 'email' } },
        bcc: { type: 'array', maxItems: MAX_EMAIL_CC, items: { type: 'string', format: 'email' } },
        attachments: {
            type: 'array',
            maxItems: MAX_EMAIL_ATTACHMENTS,
            items: {
                type: 'object',
                required: ['filename', 'content'],
                properties: {
                    filename: { type: 'string', minLength: 1, maxLength: 200 },
                    content: { type: 'string', minLength: 1, description: 'Base64 file bytes, no data: prefix' },
                },
            },
        },
        idempotencyKey: {
            type: 'string',
            minLength: 8,
            maxLength: 256,
            description: 'Client-minted; forwarded to Resend as an Idempotency-Key header (24h dedupe) so a retry after an ambiguous failure cannot double-send',
        },
    },
} as const;
