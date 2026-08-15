import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { sendMerchantEmailBodySchema } from '../routes/schemas/sendMerchantEmail';

/**
 * Guards the ROUTE schema, which the Zod and service tests cannot cover — they
 * run below the HTTP layer, on whatever object Fastify already handed over.
 * The schema under test is THE exported object routes/admin.ts registers, not
 * a copy (§19.3: tests import production predicates, never copy them — a
 * hand-kept mirror goes vacuously green on exactly the drift it exists to
 * catch).
 *
 * Measured while writing these tests (worth recording, because the intuitive
 * answer is wrong): Fastify does NOT strip an undeclared body field here.
 * Its ajv sets `removeAdditional: true`, but that only removes properties when
 * the schema also says `additionalProperties: false`, which this one does not.
 * What declaring the fields buys is REJECTION: without them, a malformed
 * address or an over-long list sails through the route layer and is caught
 * only by the controller's Zod parse. Both layers must refuse what they can
 * see — the two 400 cases below fail if the declarations are dropped.
 */
describe('POST /admin/users/:userId/send-email — route body schema', () => {
    let server: FastifyInstance;
    let received: Record<string, unknown> | null = null;

    beforeAll(async () => {
        server = fastify();
        server.post('/send-email', { schema: { body: sendMerchantEmailBodySchema } }, async (request) => {
            received = request.body as Record<string, unknown>;
            return { ok: true };
        });
        await server.ready();
    });

    afterAll(async () => {
        await server.close();
    });

    it('delivers cc, bcc, attachments and idempotencyKey through to the handler intact', async () => {
        const response = await server.inject({
            method: 'POST',
            url: '/send-email',
            payload: {
                subject: 'Invoice',
                body: 'Attached',
                cc: ['info@jawab24.com'],
                bcc: ['rep@example.com'],
                attachments: [{ filename: 'invoice.pdf', content: 'QUFB' }],
                idempotencyKey: 'a3a44c86-0a51-4d8c-9e57-2f2f4f1c9d10',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(received).toMatchObject({
            cc: ['info@jawab24.com'],
            bcc: ['rep@example.com'],
            attachments: [{ filename: 'invoice.pdf', content: 'QUFB' }],
            idempotencyKey: 'a3a44c86-0a51-4d8c-9e57-2f2f4f1c9d10',
        });
    });

    it('still accepts a bare subject + body', async () => {
        const response = await server.inject({
            method: 'POST',
            url: '/send-email',
            payload: { subject: 's', body: 'b' },
        });

        expect(response.statusCode).toBe(200);
        expect(received).toEqual({ subject: 's', body: 'b' });
    });

    it('rejects a malformed cc address at the route layer', async () => {
        const response = await server.inject({
            method: 'POST',
            url: '/send-email',
            payload: { subject: 's', body: 'b', cc: ['not-an-email'] },
        });

        expect(response.statusCode).toBe(400);
    });

    it('rejects more than the shared MAX_EMAIL_CC addresses at the route layer', async () => {
        const max = sendMerchantEmailBodySchema.properties.cc.maxItems;
        const response = await server.inject({
            method: 'POST',
            url: '/send-email',
            payload: {
                subject: 's',
                body: 'b',
                cc: Array.from({ length: max + 1 }, (_, i) => `u${i}@x.com`),
            },
        });

        expect(response.statusCode).toBe(400);
    });
});
