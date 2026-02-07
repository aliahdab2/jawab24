import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Convert a Zod schema to JSON Schema for Fastify route definitions */
export function zs(schema: z.ZodTypeAny): Record<string, unknown> {
    // The `as any` cast is required — zodToJsonSchema has excessively deep type instantiation without it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsonSchema = zodToJsonSchema(schema as any, { target: 'openApi3' }) as Record<string, unknown>;
    // Remove the top-level $schema property that Fastify doesn't expect
    const { $schema: _schema, ...rest } = jsonSchema;
    return rest;
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
