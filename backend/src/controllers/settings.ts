import { FastifyReply } from 'fastify';
import { settingsService } from '../services/settings';
import { imageStorage } from '../services/imageStorage';
import { smartTranslateMultiLang } from '../services/multiLangTranslation';
import { AuthenticatedRequest } from '../middleware/auth';
import type { WorkspaceRequest } from '../middleware/workspace';
import { recordAutoreplyEnabledIfEffective } from '../services/activation';
import { UpdateSettingsSchema, MAX_BRAND_VOICE_LENGTH } from '@jawab24/shared';
import { validateSchema } from '../utils/validation';
import { translateText, generateNudgeVariations } from '../services/translation';
import type { UpdateSettingsDTO } from '../types/settings';
import { auditLog } from '../services/auditLog';
import { t } from '../utils/i18n';

/** Default messages restored when the source language is cleared (matches frontend i18n) */
const DEFAULT_MESSAGES: Record<string, Record<string, string>> = {
    awayMessage: {
        ar: t('defaultAway', 'ar'),
        en: t('defaultAway', 'en'),
    },
    greetingMessage: {
        ar: 'أهلاً بك! كيف يمكنني مساعدتك؟',
        en: 'Welcome! How can I help you?',
    },
    dualReplyNudge: {
        ar: t('dualNudgeDefault', 'ar'),
        en: t('dualNudgeDefault', 'en'),
    },
    limitFallbackMessage: {
        ar: t('commentFallback', 'ar'),
        en: t('commentFallback', 'en'),
    },
    brandVoiceNotes: {
        ar: '',
        en: '',
    },
};

/**
 * Per-field max length, mirroring the `.max()` caps in
 * packages/shared/src/schemas/settings.ts. Passed into smartTranslateMultiLang so
 * machine translations are clamped to the cap. Only brandVoiceNotesMulti is
 * schema-capped today; away/greeting/nudge `*Multi` fields are uncapped, so they
 * need no clamp. Without this, an AR→EN translation that expands past the cap is
 * stored over-cap and later blocks ALL settings saves (the diff resends it and Zod
 * rejects it).
 */
const FIELD_MAX_LENGTHS: Record<string, number | undefined> = {
    brandVoiceNotes: MAX_BRAND_VOICE_LENGTH,
};

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
            // Server capability flag (not a stored setting): Post Reply image attachments
            // are available only when object storage is configured. The frontend gates
            // the image picker on this.
            return reply.send({ ...settings, triggerImagesEnabled: imageStorage.isConfigured() });
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

            // Smart auto-translation lives in the shared multiLangTranslation module
            // (used identically by every multilingual settings field). Here we just
            // inject this request's translation call + logging and reuse it per field.
            const handleSmartTranslation = (
                updateMulti: Record<string, string> | undefined | null,
                currentMulti: Record<string, string> | undefined | null,
                fieldName: string
            ): Promise<Record<string, string>> =>
                smartTranslateMultiLang(updateMulti, currentMulti, fieldName, {
                    supportedLanguages,
                    defaults: DEFAULT_MESSAGES[fieldName],
                    maxLength: FIELD_MAX_LENGTHS[fieldName],
                    translate: async (text, sourceLanguage, targetLanguage) =>
                        (await translateText({ text, sourceLanguage, targetLanguage, userId })).translatedText,
                    onError: ({ fieldName, sourceLang, targetLang, error }) =>
                        request.log.error({ error: String(error) }, `Translation failed for ${fieldName} (${sourceLang}->${targetLang})`),
                });

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

            // Apply logic for Limit-Reached Fallback Message
            if (updates.limitFallbackMessageMulti) {
                updates.limitFallbackMessageMulti = await handleSmartTranslation(
                    updates.limitFallbackMessageMulti,
                    currentSettings.limitFallbackMessageMulti,
                    'limitFallbackMessage'
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

            // Generate nudge variations when nudge text changes (anti-spam for dual mode)
            if (updates.dualReplyNudgeMulti) {
                const nudgeMulti = updates.dualReplyNudgeMulti;
                const currentNudge = currentSettings.dualReplyNudgeMulti || {};
                const changedLangs = supportedLanguages.filter(lang =>
                    nudgeMulti[lang] && nudgeMulti[lang] !== currentNudge[lang]
                );

                if (changedLangs.length > 0) {
                    const variations: Record<string, string[]> = {};
                    const jobs = supportedLanguages
                        .filter(lang => nudgeMulti[lang])
                        .map(async (lang) => {
                            try {
                                variations[lang] = await generateNudgeVariations(nudgeMulti[lang], lang, 10, { userId });
                            } catch (e) {
                                request.log.error({ error: String(e) }, `Nudge variation generation failed (${lang})`);
                            }
                        });
                    await Promise.all(jobs);
                    if (Object.keys(variations).length > 0) {
                        updates.dualReplyNudgeVariations = variations;
                    }
                }
            }

            // Apply logic for Brand Voice Notes
            if (updates.brandVoiceNotesMulti) {
                updates.brandVoiceNotesMulti = await handleSmartTranslation(
                    updates.brandVoiceNotesMulti,
                    currentSettings.brandVoiceNotesMulti,
                    'brandVoiceNotes'
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

            // Legacy brandVoiceNotes compatibility — keep old text column in sync so the
            // two columns never diverge. Cleared multi → empty string clears the old column.
            if (updates.brandVoiceNotesMulti !== undefined && updates.brandVoiceNotesMulti !== null) {
                updates.brandVoiceNotes = updates.brandVoiceNotesMulti['en'] || updates.brandVoiceNotesMulti['ar'] || '';
            }
            // The workspace this request resolved, membership-verified by the
            // middleware — pipeline fields sync THERE, not to whichever
            // membership row comes back first. This replaces the D-085
            // reply-mode-only guard: fixing the destination covers all 30
            // PIPELINE_FIELDS and every save, where the guard covered one field
            // and only when that field was in the payload.
            const settings = await settingsService.updateSettings(
                userId, updates, (request as WorkspaceRequest).workspaceId,
            );

            // Activation funnel (D-026): a save that turns an auto-reply master ON
            // (comments or messages, false→true) is the real activation moment for
            // new signups — the page-level toggle no longer counts alone.
            // currentSettings is the effective (workspace-overlaid) state.
            const wsReq = request as WorkspaceRequest;
            const prevOn = !!(currentSettings.commentsAutoReply || currentSettings.messagesAutoReply);
            const nextOn = !!((updates.commentsAutoReply ?? currentSettings.commentsAutoReply)
                || (updates.messagesAutoReply ?? currentSettings.messagesAutoReply));
            if (!prevOn && nextOn && wsReq.workspaceId) {
                void recordAutoreplyEnabledIfEffective(
                    wsReq.workspaceOwnerId ?? userId,
                    wsReq.workspaceId,
                    { source: 'settings' },
                );
            }

            // Audit trail (fire-and-forget)
            auditLog({
                userId,
                action: 'settings.updated',
                entityType: 'settings',
                metadata: { fields: Object.keys(updates) },
            });

            return reply.send(settings);
        } catch (error) {
            request.log.error({ error: String(error) }, 'Error updating settings');
            return reply.status(500).send({ error: 'Failed to update settings' });
        }
    }

}

export const settingsController = new SettingsController();
