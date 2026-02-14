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
            if (updates.greetingMessage) {
                // If both AR and EN are provided explicitly, skip auto-translation
                const explicitBoth = updates.greetingMessageAr && updates.greetingMessageEn;
                
                if (!explicitBoth) {
                    const sourceText = updates.greetingMessage;
                    const detectionResult = detectLanguage(sourceText);
                    const sourceLang = detectionResult.language === 'ar' ? 'ar' : 'en';
                    const targetLang = sourceLang === 'ar' ? 'en' : 'ar';

                    try {
                        // Only translate if the TARGET language is missing
                        // e.g. if source is AR, and EN is missing -> translate
                        const targetMissing = targetLang === 'ar' ? !updates.greetingMessageAr : !updates.greetingMessageEn;

                        if (targetMissing) {
                            const translation = await translateText({
                                text: sourceText,
                                sourceLanguage: sourceLang,
                                targetLanguage: targetLang
                            });

                            // Fill missing fields
                            if (targetLang === 'ar') updates.greetingMessageAr = translation.translatedText;
                            if (targetLang === 'en') updates.greetingMessageEn = translation.translatedText;
                        }

                        // Always ensure source is set if missing
                        if (sourceLang === 'ar' && !updates.greetingMessageAr) updates.greetingMessageAr = sourceText;
                        if (sourceLang === 'en' && !updates.greetingMessageEn) updates.greetingMessageEn = sourceText;
                        
                        updates.greetingMessageSourceLang = sourceLang;
                    } catch (error) {
                        // Fallback: store original in detected language only
                        if (sourceLang === 'ar' && !updates.greetingMessageAr) updates.greetingMessageAr = sourceText;
                        if (sourceLang === 'en' && !updates.greetingMessageEn) updates.greetingMessageEn = sourceText;
                        updates.greetingMessageSourceLang = sourceLang;
                        request.log.error({ error: String(error) }, 'Translation failed for greeting message');
                    }
                }
            }

            // Auto-translate away message if provided
            if (updates.awayMessage) {
                // If both AR and EN are provided explicitly, skip auto-translation
                const explicitBoth = updates.awayMessageAr && updates.awayMessageEn;

                if (!explicitBoth) {
                    const sourceText = updates.awayMessage;
                    const detectionResult = detectLanguage(sourceText);
                    const sourceLang = detectionResult.language === 'ar' ? 'ar' : 'en';
                    const targetLang = sourceLang === 'ar' ? 'en' : 'ar';

                    try {
                        // Only translate if the TARGET language is missing
                        const targetMissing = targetLang === 'ar' ? !updates.awayMessageAr : !updates.awayMessageEn;

                        if (targetMissing) {
                            const translation = await translateText({
                                text: sourceText,
                                sourceLanguage: sourceLang,
                                targetLanguage: targetLang
                            });

                            // Fill missing fields
                            if (targetLang === 'ar') updates.awayMessageAr = translation.translatedText;
                            if (targetLang === 'en') updates.awayMessageEn = translation.translatedText;
                        }

                        // Always ensure source is set if missing
                        if (sourceLang === 'ar' && !updates.awayMessageAr) updates.awayMessageAr = sourceText;
                        if (sourceLang === 'en' && !updates.awayMessageEn) updates.awayMessageEn = sourceText;

                        updates.awayMessageSourceLang = sourceLang;
                    } catch (error) {
                        // Fallback
                        if (sourceLang === 'ar' && !updates.awayMessageAr) updates.awayMessageAr = sourceText;
                        if (sourceLang === 'en' && !updates.awayMessageEn) updates.awayMessageEn = sourceText;
                        updates.awayMessageSourceLang = sourceLang;
                        request.log.error({ error: String(error) }, 'Translation failed for away message');
                    }
                }
            }

            // If specific fields are provided but legacy `awayMessage` is missing/empty, 
            // backfill it for compatibility (prefer EN, then AR)
            if (!updates.awayMessage && (updates.awayMessageEn || updates.awayMessageAr)) {
                updates.awayMessage = updates.awayMessageEn || updates.awayMessageAr;
            }
            if (!updates.greetingMessage && (updates.greetingMessageEn || updates.greetingMessageAr)) {
                updates.greetingMessage = updates.greetingMessageEn || updates.greetingMessageAr;
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
