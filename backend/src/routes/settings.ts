import { FastifyInstance } from 'fastify';
import { settingsController } from '../controllers/settings';
import { authenticate } from '../middleware/auth';
import { auth } from '../utils/swagger';

export default async function settingsRoutes(fastify: FastifyInstance) {
    fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', authenticate);

        protectedRoutes.get('/settings', {
            schema: {
                tags: ['Settings'],
                summary: 'Get user settings',
                security: auth,
            },
        }, settingsController.get);

        protectedRoutes.put('/settings', {
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
                    },
                    additionalProperties: false,
                },
            },
        }, settingsController.update);
    });
}
