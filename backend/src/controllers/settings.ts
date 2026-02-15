import { FastifyReply } from 'fastify';
import { settingsService } from '../services/settings';
import { AuthenticatedRequest } from '../middleware/auth';
import { validateSchema, UpdateSettingsSchema } from '../utils/validation';
import { translateText } from '../services/translation';
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

            // Fetch current settings for comparison
            const currentSettings = await settingsService.getSettings(userId);

            // --- Smart Auto-Translation Logic (JSONB) ---
            const supportedLanguages = currentSettings.supportedLanguages || ['ar', 'en'];

            const handleSmartTranslation = async (
                updateMulti: Record<string, string> | undefined | null,
                currentMulti: Record<string, string> | undefined | null,
                fieldName: string
            ): Promise<Record<string, string>> => {
                if (!updateMulti) return currentMulti || {};

                // Merge updates into result
                // We start with current state, but we only apply UPDATES that are actually present
                const current = currentMulti || {};
                const result = { ...current, ...updateMulti };
                
                // Identify which content keys changed
                const contentKeys = supportedLanguages;
                const changedKeys = contentKeys.filter(lang => 
                    updateMulti[lang] !== undefined && updateMulti[lang] !== current[lang]
                );

                if (changedKeys.length === 0) return result; // No content changes

                // Logic:
                // 1. If > 1 language changed simultaneously -> Manual (don't overwrite anything)
                if (changedKeys.length > 1) {
                    result.sourceLang = 'manual';
                    return result;
                }

                // 2. If 1 language changed
                let sourceLang = changedKeys[0];
                let sourceText = result[sourceLang];

                // --- Special Case: Reset to Auto ---
                // If the user cleared a field, they might want to "reset" it to auto-translation
                // from the remaining language.
                if (!sourceText) {
                    const otherLangs = contentKeys.filter(lang => lang !== sourceLang && result[lang]);
                    if (otherLangs.length === 1) {
                        // Found exactly one candidate to translate FROM
                        sourceLang = otherLangs[0];
                        sourceText = result[sourceLang];
                    } else {
                        // No clear source to translate from after reset
                        result.sourceLang = sourceLang;
                        return result;
                    }
                }
                
                result.sourceLang = sourceLang;

                // Iterate over other languages and translate
                for (const targetLang of supportedLanguages) {
                    if (targetLang === sourceLang) continue;

                    // We translate if:
                    // A. Target is empty in result
                    // B. OR Target is unchanged from current state (frontend sent old value)
                    // C. AND we are in 'auto' mode (single changed sourceLang)
                    
                    const isTargetEmpty = !result[targetLang];
                    // If target is not in updateMulti at all, consider it unchanged (so it's a candidate for auto-sync)
                    const isTargetUnchanged = updateMulti[targetLang] === undefined || updateMulti[targetLang] === current[targetLang];

                    if (isTargetEmpty || isTargetUnchanged) {
                        try {
                            const translation = await translateText({
                                text: sourceText,
                                sourceLanguage: sourceLang as 'ar' | 'en',
                                targetLanguage: targetLang as 'ar' | 'en'
                            });
                            result[targetLang] = translation.translatedText;
                        } catch (e) {
                            request.log.error({ error: String(e) }, `Translation failed for ${fieldName} (${sourceLang}->${targetLang})`);
                        }
                    }
                }
                
                return result;
            };

            // Apply logic for Greeting Message
            if (updates.greetingMessageMulti) {
                updates.greetingMessageMulti = await handleSmartTranslation(
                    updates.greetingMessageMulti,
                    currentSettings.greetingMessageMulti,
                    'greetingMessage'
                );
            }

            // Apply logic for Away Message
            if (updates.awayMessageMulti) {
                updates.awayMessageMulti = await handleSmartTranslation(
                    updates.awayMessageMulti,
                    currentSettings.awayMessageMulti,
                    'awayMessage'
                );
            }
            
            // Apply logic for Dual Reply Nudge
            if (updates.dualReplyNudgeMulti) {
                updates.dualReplyNudgeMulti = await handleSmartTranslation(
                    updates.dualReplyNudgeMulti,
                    currentSettings.dualReplyNudgeMulti,
                    'dualReplyNudge'
                );
            }

            // If specific fields are provided but legacy `awayMessage` is missing/empty, 
            // backfill it for compatibility (prefer EN, then AR from Multi)
            if (!updates.awayMessage && updates.awayMessageMulti) {
                updates.awayMessage = updates.awayMessageMulti['en'] || updates.awayMessageMulti['ar'];
            }
            if (!updates.greetingMessage && updates.greetingMessageMulti) {
                updates.greetingMessage = updates.greetingMessageMulti['en'] || updates.greetingMessageMulti['ar'];
            }
            
            // Legacy dualReplyNudge compatibility
            if (!updates.dualReplyNudge && updates.dualReplyNudgeMulti) {
                updates.dualReplyNudge = updates.dualReplyNudgeMulti['en'] || updates.dualReplyNudgeMulti['ar'];
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
