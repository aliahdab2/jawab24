import { FastifyReply } from 'fastify';
import { settingsService } from '../services/settings';
import { AuthenticatedRequest } from '../middleware/auth';
import { validateSchema, UpdateSettingsSchema } from '../utils/validation';
import { translateText, autoTranslateTranslations } from '../utils/translate';

export class SettingsController {
    /**
     * Get user settings
     * GET /settings
     */
    async get(request: AuthenticatedRequest, reply: FastifyReply) {
        try {
            // Safety check for user
            if (!request.user) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const userId = request.user.userId;
            const settings = await settingsService.getSettings(userId);
            return reply.send(settings);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error getting settings');
            return reply.status(500).send({ error: 'Failed to get settings' });
        }
    }

    /**
     * Update user settings
     * PUT /settings
     *
     * Auto-translates dualReplyConfig (en↔ar) on save.
     */
    async update(request: AuthenticatedRequest, reply: FastifyReply) {
        try {
            // Safety check for user
            if (!request.user) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const userId = request.user.userId;

            // Validate request body
            const validation = validateSchema(UpdateSettingsSchema, request.body);
            if (!validation.success) {
                request.log.error({ errors: validation.errors }, 'Invalid settings update payload');
                return reply.status(400).send({
                    error: 'Invalid request',
                    details: validation.errors
                });
            }

            const updates = validation.data;

            // Auto-translate dual reply nudge text
            if (updates.dualReplyConfig) {
                try {
                    updates.dualReplyConfig = await autoTranslateTranslations(
                        updates.dualReplyConfig as Record<string, string>,
                        { maxLength: 80 },
                    );
                } catch {
                    // Graceful degradation — save with original text
                }
            }

            const settings = await settingsService.updateSettings(userId, updates);
            return reply.send(settings);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error updating settings');
            return reply.status(500).send({ error: 'Failed to update settings' });
        }
    }

    /**
     * Translate a dual reply nudge message.
     * POST /settings/translate-nudge
     *
     * Detects the source language, translates to the other (en↔ar).
     * Returns { en, ar, sourceLang } so the frontend can show the preview.
     */
    async translateNudge(request: AuthenticatedRequest, reply: FastifyReply) {
        if (!request.user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const { text } = request.body as { text?: string };
        if (!text || !text.trim()) {
            return reply.send({ en: '', ar: '', sourceLang: 'en' });
        }

        const result = await translateText(text, { maxLength: 80 });
        return reply.send({ en: result.en, ar: result.ar, sourceLang: result.sourceLang });
    }
}

export const settingsController = new SettingsController();










