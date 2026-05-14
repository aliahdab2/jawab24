import { FastifyInstance } from 'fastify';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { UpdateSettingsSchema } from '@jawab24/shared';
import { settingsController } from '../controllers/settings';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

// Strip the `$schema` metadata so Ajv doesn't load it as a meta-schema. Inline
// (`$refStrategy: 'none'`) keeps the schema flat — Fastify validates a single
// object body, not a $ref graph.
//
// The cast bypasses a TS2589 ("excessively deep type instantiation") from
// zod-to-json-schema's overload when introspecting a `.strict()` schema that
// contains a `.refine()` predicate (the timezone field). Runtime behavior is
// unchanged — we only sidestep the type-level recursion.
const generateBodySchema = zodToJsonSchema as unknown as (
    schema: unknown,
    options: { target: string; $refStrategy: string },
) => Record<string, unknown>;

const updateSettingsBodySchema = (() => {
    const generated = generateBodySchema(UpdateSettingsSchema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
    });
    delete generated.$schema;
    return generated;
})();

export default async function settingsRoutes(fastify: FastifyInstance) {
    // --- Read: all workspace members ---
    fastify.register(async (readRoutes) => {
        readRoutes.addHook('preHandler', authenticate);
        readRoutes.addHook('preHandler', resolveWorkspace);

        readRoutes.get('/settings', {
            schema: {
                tags: ['Settings'],
                summary: 'Get user settings',
                security: auth,
            },
        }, settingsController.get);
    });

    // --- Write: admin+ only ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        adminRoutes.put('/settings', {
            schema: {
                tags: ['Settings'],
                summary: 'Update user settings',
                security: auth,
                // Body schema is generated from the canonical Zod schema in
                // `@jawab24/shared` (single source of truth shared with the
                // frontend pre-submit validator).
                body: updateSettingsBodySchema,
            },
        }, settingsController.update);
    });
}
