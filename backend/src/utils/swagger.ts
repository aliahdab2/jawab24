import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

type ZodToJsonSchemaFn = (schema: z.ZodTypeAny, opts: { target: string }) => Record<string, unknown>;

/** Convert a Zod schema to JSON Schema for Fastify route definitions */
export function zs(schema: z.ZodTypeAny): Record<string, unknown> {
    const jsonSchema = (zodToJsonSchema as unknown as ZodToJsonSchemaFn)(schema, { target: 'openApi3' });
    delete jsonSchema.$schema;
    return jsonSchema;
}

// ── Shared parameter schemas ──

export const IdParam = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] };

export const CursorQuery = {
    type: 'object',
    properties: {
        cursor: { type: 'string', description: 'Pagination cursor (last item ID)' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    },
};

export const PaginationQuery = {
    type: 'object',
    properties: {
        page: { type: 'integer', minimum: 1, default: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
};

// ── Shared response schemas ──

export const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'boolean', enum: [true] },
        message: { type: 'string' },
        code: { type: 'string' },
        details: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    message: { type: 'string' },
                },
            },
        },
    },
};

export const MessageResponse = {
    type: 'object',
    properties: {
        message: { type: 'string' },
    },
};

// Shorthand for authenticated route schema
export const auth = [{ bearerAuth: [] as string[] }];
