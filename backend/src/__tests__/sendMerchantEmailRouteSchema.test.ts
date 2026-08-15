import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';

/**
 * Guards the ROUTE schema, which the Zod and service tests cannot cover — they
 * run below the HTTP layer, on whatever object Fastify already handed over.
 *
 * Measured while writing these tests (worth recording, because the intuitive
 * answer is wrong): Fastify does NOT strip an undeclared body field here.
 * Its ajv sets `removeAdditional: true`, but that only removes properties when
 * the schema also says `additionalProperties: false`, which this one does not —
 * so deleting `cc` from the schema still delivers `cc` to the handler.
 *
 * What declaring the fields actually buys is REJECTION: without them, a
 * malformed address or a 50-address list sails through the route layer and is
 * caught only by the controller's Zod parse. Both layers should refuse it, and
 * the two 400 cases below are what fail if the declarations are dropped.
 *
 * Mirrors the body schema registered in routes/admin.ts for
 * POST /admin/users/:userId/send-email. If that schema changes, change this too.
 */

const BODY_SCHEMA = {
    type: 'object',
    required: ['subject', 'body'],
    properties: {
        subject: { type: 'string', minLength: 1, maxLength: 500 },
        body: { type: 'string', minLength: 1, maxLength: 20_000 },
        cc: { type: 'array', maxItems: 5, items: { type: 'string', format: 'email' } },
        bcc: { type: 'array', maxItems: 5, items: { type: 'string', format: 'email' } },
        attachments: {
            type: 'array',
            maxItems: 3,
            items: {
                type: 'object',
                required: ['filename', 'content'],
                properties: {
                    filename: { type: 'string', minLength: 1, maxLength: 200 },
                    content: { type: 'string', minLength: 1 },
                },
            },
        },
    },
} as const;

describe('POST /admin/users/:userId/send-email — route body schema', () => {
    let server: FastifyInstance;
    let received: Record<string, unknown> | null = null;

    beforeAll(async () => {
        server = fastify();
        server.post('/send-email', { schema: { body: BODY_SCHEMA } }, async (request) => {
            received = request.body as Record<string, unknown>;
            return { ok: true };
        });
        await server.ready();
    });

    afterAll(async () => {
        await server.close();
    });

    it('delivers cc, bcc and attachments through to the handler intact', async () => {
        const response = await server.inject({
            method: 'POST',
            url: '/send-email',
            payload: {
                subject: 'Invoice',
                body: 'Attached',
                cc: ['info@jawab24.com'],
                bcc: ['rep@example.com'],
                attachments: [{ filename: 'invoice.pdf', content: 'QUFB' }],
            },
        });

        expect(response.statusCode).toBe(200);
        expect(received).toMatchObject({
            cc: ['info@jawab24.com'],
            bcc: ['rep@example.com'],
            attachments: [{ filename: 'invoice.pdf', content: 'QUFB' }],
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

    it('rejects more than five cc addresses at the route layer', async () => {
        const response = await server.inject({
            method: 'POST',
            url: '/send-email',
            payload: {
                subject: 's',
                body: 'b',
                cc: Array.from({ length: 6 }, (_, i) => `u${i}@x.com`),
            },
        });

        expect(response.statusCode).toBe(400);
    });
});
