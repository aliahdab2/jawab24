import { FastifyInstance } from 'fastify';
import { settingsController } from '../controllers/settings';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

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
                body: {
                    type: 'object',
                    properties: {
                        dashboardLanguage: { type: 'string', minLength: 2, maxLength: 10 },
                        defaultReplyLanguage: { type: 'string', minLength: 2, maxLength: 10 },
                        supportedLanguages: { type: 'array', items: { type: 'string', minLength: 2, maxLength: 10 } },
                        autoDetectLanguage: { type: 'boolean' },
                        aiEnabled: { type: 'boolean' },
                        aiModel: { type: 'string' },
                        commentsAutoReply: { type: 'boolean' },
                        messagesAutoReply: { type: 'boolean' },
                        businessHoursOnly: { type: 'boolean' },
                        businessHoursStart: { type: 'string' },
                        businessHoursEnd: { type: 'string' },
                        timezone: { type: 'string', maxLength: 100 },
                        awayMessage: { type: 'string', maxLength: 500 },
                        awayMessageMulti: { type: 'object' },
                        replyDelay: { type: 'integer', minimum: 0, maximum: 300 },
                        greetingMessage: { type: 'string', maxLength: 500 },
                        greetingMessageMulti: { type: 'object' },
                        commentReplyMode: { type: 'string', enum: ['public', 'private', 'dual'] },
                        dualReplyNudge: { type: 'string', maxLength: 80 },
                        dualReplyNudgeMulti: { type: 'object' },
                        handoffPauseDurationMinutes: { type: 'integer', minimum: 5, maximum: 1440 },
                        commentEscalationMinutes: { type: 'integer', minimum: 5, maximum: 1440 },
                        messageEscalationMinutes: { type: 'integer', minimum: 5, maximum: 1440 },
                        notificationsEnabled: { type: 'boolean' },
                        replyStyle: { type: 'string', enum: ['professional', 'casual', 'enthusiastic'] },
                        brandVoiceNotes: { type: 'string', maxLength: 500 },
                        brandVoiceNotesMulti: { type: 'object' },
                        holdLowConfidence: { type: 'boolean' },
                    },
                    additionalProperties: false,
                },
            },
        }, settingsController.update);
    });
}
