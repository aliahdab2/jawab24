import { FastifyReply } from 'fastify';
import { settingsService } from '../services/settings';
import { AuthenticatedRequest } from '../middleware/auth';
import { validateSchema, UpdateSettingsSchema } from '../utils/validation';
import { translateText } from '../services/translation';
import { detectLanguage } from '../utils/language';
import type { UpdateSettingsDTO } from '../types/settings';

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

            const updates = validation.data as UpdateSettingsDTO;

            // Auto-translate greeting message if provided
            if (updates.greetingMessage !== undefined && updates.greetingMessage) {
                const sourceText = updates.greetingMessage;
                const detectionResult = detectLanguage(sourceText);
                const sourceLang = detectionResult.language === 'ar' ? 'ar' : 'en';
                const targetLang = sourceLang === 'ar' ? 'en' : 'ar';

                try {
                    const translation = await translateText({
                        text: sourceText,
                        sourceLanguage: sourceLang,
                        targetLanguage: targetLang
                    });

                    // Store both versions
                    updates.greetingMessageAr = sourceLang === 'ar' ? sourceText : translation.translatedText;
                    updates.greetingMessageEn = sourceLang === 'en' ? sourceText : translation.translatedText;
                    updates.greetingMessageSourceLang = sourceLang;
                } catch (error) {
                    // Fallback: store original in detected language only
                    if (sourceLang === 'ar') {
                        updates.greetingMessageAr = sourceText;
                    } else {
                        updates.greetingMessageEn = sourceText;
                    }
                    updates.greetingMessageSourceLang = sourceLang;
                    request.log.error({ error: String(error) }, 'Translation failed for greeting message');
                }
            }

            // Auto-translate away message if provided
            if (updates.awayMessage !== undefined && updates.awayMessage) {
                const sourceText = updates.awayMessage;
                const detectionResult = detectLanguage(sourceText);
                const sourceLang = detectionResult.language === 'ar' ? 'ar' : 'en';
                const targetLang = sourceLang === 'ar' ? 'en' : 'ar';

                try {
                    const translation = await translateText({
                        text: sourceText,
                        sourceLanguage: sourceLang,
                        targetLanguage: targetLang
                    });

                    // Store both versions
                    updates.awayMessageAr = sourceLang === 'ar' ? sourceText : translation.translatedText;
                    updates.awayMessageEn = sourceLang === 'en' ? sourceText : translation.translatedText;
                    updates.awayMessageSourceLang = sourceLang;
                } catch (error) {
                    // Fallback: store original in detected language only
                    if (sourceLang === 'ar') {
                        updates.awayMessageAr = sourceText;
                    } else {
                        updates.awayMessageEn = sourceText;
                    }
                    updates.awayMessageSourceLang = sourceLang;
                    request.log.error({ error: String(error) }, 'Translation failed for away message');
                }
            }

            const settings = await settingsService.updateSettings(userId, updates);
            return reply.send(settings);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error updating settings');
            return reply.status(500).send({ error: 'Failed to update settings' });
        }
    }

}

export const settingsController = new SettingsController();
