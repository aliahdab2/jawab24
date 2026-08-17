import { z } from 'zod';
import { MAX_TEMPLATE_MESSAGE_LENGTH, MAX_BRAND_VOICE_LENGTH } from '../constants';
import { isValidTimezone } from '../timezone';

/**
 * Single source of truth for the `PUT /api/settings` payload shape.
 *
 * Consumed by:
 *   - Backend route ([backend/src/routes/settings.ts]) — converted to a Fastify
 *     JSON schema with `zod-to-json-schema` so Fastify validates the raw body
 *     before the handler runs.
 *   - Backend controller ([backend/src/controllers/settings.ts]) — re-validates
 *     as defense in depth and to extract field-level error messages for the
 *     response body.
 *   - Frontend save handler ([frontend/src/pages/settings.tsx]) — pre-validates
 *     before the PUT so the user gets inline field-level errors instead of a
 *     round-trip 400 with a generic toast.
 *
 * `.strict()` ensures unknown keys are rejected on the backend (matches the
 * Fastify schema's `additionalProperties: false` that this replaces).
 */
export const UpdateSettingsSchema = z.object({
    dashboardLanguage: z.string().min(2).max(10).optional(),
    defaultReplyLanguage: z.string().min(2).max(10).optional(),
    supportedLanguages: z.array(z.string().min(2).max(10)).optional(),
    autoDetectLanguage: z.boolean().optional(),
    aiEnabled: z.boolean().optional(),
    aiModel: z.string().optional(),
    commentsAutoReply: z.boolean().optional(),
    messagesAutoReply: z.boolean().optional(),
    businessHoursOnly: z.boolean().optional(),
    businessHoursStart: z
        .string()
        .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)')
        .optional(),
    businessHoursEnd: z
        .string()
        .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)')
        .optional(),
    timezone: z
        .string()
        .max(100)
        .refine(isValidTimezone, { message: 'Invalid IANA timezone' })
        .optional(),
    awayMessage: z
        .string()
        .max(MAX_TEMPLATE_MESSAGE_LENGTH, `Away message must be ${MAX_TEMPLATE_MESSAGE_LENGTH} characters or fewer`)
        .optional(),
    awayMessageMulti: z.record(z.string()).optional(),
    replyDelay: z.number().int().min(0).max(300, 'Reply delay must be between 0-300 seconds').optional(),
    greetingMessage: z
        .string()
        .max(MAX_TEMPLATE_MESSAGE_LENGTH, `Greeting message must be ${MAX_TEMPLATE_MESSAGE_LENGTH} characters or fewer`)
        .optional(),
    greetingMessageMulti: z.record(z.string()).optional(),
    greetingMessageEnabled: z.boolean().optional(),
    limitFallbackEnabled: z.boolean().optional(),
    limitFallbackMessageMulti: z.record(z.string()).optional(),
    commentReplyMode: z.enum(['public', 'private', 'dual']).optional(),
    likeComments: z.boolean().optional(),
    dualReplyNudge: z.string().max(80).optional(),
    dualReplyNudgeMulti: z.record(z.string()).optional(),
    dualReplyNudgeVariations: z.record(z.array(z.string().max(80))).optional(),
    handoffPauseDurationMinutes: z.number().int().min(5).max(1440).optional(),
    commentEscalationMinutes: z.number().int().min(5, 'Minimum 5 minutes').max(1440, 'Maximum 24 hours').optional(),
    messageEscalationMinutes: z.number().int().min(5, 'Minimum 5 minutes').max(1440, 'Maximum 24 hours').optional(),
    notificationsEnabled: z.boolean().optional(),
    newLeadAlertsEnabled: z.boolean().optional(),
    replyStyle: z.enum(['professional', 'casual', 'enthusiastic']).optional(),
    replyMode: z.enum(['sales', 'info']).optional(),
    brandVoiceNotes: z
        .string()
        .max(MAX_BRAND_VOICE_LENGTH, `Brand voice notes must be ${MAX_BRAND_VOICE_LENGTH} characters or fewer`)
        .optional(),
    brandVoiceNotesMulti: z.record(z.string().max(MAX_BRAND_VOICE_LENGTH)).optional(),
    holdLowConfidence: z.boolean().optional(),
    onboardingCompletedAt: z.string().datetime().nullable().optional(),
}).strict();

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;
