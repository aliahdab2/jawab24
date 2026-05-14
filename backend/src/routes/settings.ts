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
const updateSettingsBodySchema = (() => {
    // @ts-expect-error TS2589: zod-to-json-schema's overload triggers
    // "excessively deep type instantiation" when introspecting a `.strict()`
    // schema that contains a `.refine()` predicate (the timezone field).
    // Runtime behavior is unchanged.
    const generated = zodToJsonSchema(UpdateSettingsSchema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
    }) as Record<string, unknown>;
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
