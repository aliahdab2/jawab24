import { FastifyReply } from 'fastify';
import axios from 'axios';
import { settingsService } from '../services/settings';
import { AuthenticatedRequest } from '../middleware/auth';
import { validateSchema, UpdateSettingsSchema } from '../utils/validation';
import { detectLanguageCode } from '../utils/language';
import { config } from '../config';

/**
 * Auto-translate the dual reply nudge text.
 * User writes in one language → we detect it and translate to the other.
 * Falls back to same text for both if translation fails.
 */
async function translateDualReplyConfig(
    cfg: Record<string, string>,
    logger: { error: (obj: Record<string, unknown>, msg: string) => void },
): Promise<Record<string, string>> {
    // Find the user-provided text (en and ar are set to the same value by the frontend)
    const text = cfg.en || cfg.ar || '';
    if (!text.trim()) return cfg;

    const sourceLang = detectLanguageCode(text);
    const targetLang = sourceLang === 'ar' ? 'en' : 'ar';
    const targetLabel = targetLang === 'ar' ? 'Arabic' : 'English';

    // If no OpenAI key, keep same text for both
    if (!config.openai?.apiKey) return { en: text, ar: text };

    try {
        const response = await axios.post<{ choices: { message: { content: string } }[] }>(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Translate the following short message to ${targetLabel}. Return ONLY the translation, nothing else. Keep emojis. Max 80 characters.`,
                    },
                    { role: 'user', content: text },
                ],
                max_tokens: 100,
                temperature: 0.3,
            },
            {
                headers: {
                    Authorization: `Bearer ${config.openai.apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            },
        );

        const translated = response.data.choices[0]?.message?.content?.trim().slice(0, 80);
        if (!translated) return { en: text, ar: text };

        return {
            [sourceLang === 'ar' ? 'ar' : 'en']: text,
            [targetLang]: translated,
        };
    } catch (error) {
        logger.error(
            { error: error instanceof Error ? error.message : String(error) },
            'Failed to translate dual reply nudge, using same text for both languages',
        );
        return { en: text, ar: text };
    }
}

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

            const updates = validation.data;

            // Auto-translate dual reply nudge if present
            if (updates.dualReplyConfig) {
                updates.dualReplyConfig = await translateDualReplyConfig(
                    updates.dualReplyConfig,
                    request.log,
                );
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










