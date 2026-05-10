import { z } from 'zod';
import { MAX_TEMPLATE_MESSAGE_LENGTH } from '@jawab24/shared';

/**
 * Validation Schemas for API Requests
 * Using Zod for type-safe validation
 */

// ==========================================
// Settings
// ==========================================
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
    businessHoursStart: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)').optional(),
    businessHoursEnd: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)').optional(),
    timezone: z.string().max(100).refine(
        (tz) => { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; } },
        { message: 'Invalid IANA timezone' }
    ).optional(),
    awayMessage: z.string().max(MAX_TEMPLATE_MESSAGE_LENGTH, `Away message must be ${MAX_TEMPLATE_MESSAGE_LENGTH} characters or fewer`).optional(),
    awayMessageMulti: z.record(z.string()).optional(),
    replyDelay: z.number().int().min(0).max(300, 'Reply delay must be between 0-300 seconds').optional(),
    greetingMessage: z.string().max(MAX_TEMPLATE_MESSAGE_LENGTH, `Greeting message must be ${MAX_TEMPLATE_MESSAGE_LENGTH} characters or fewer`).optional(),
    greetingMessageMulti: z.record(z.string()).optional(),
    limitFallbackEnabled: z.boolean().optional(),
    limitFallbackMessageMulti: z.record(z.string()).optional(),
    commentReplyMode: z.enum(['public', 'private', 'dual']).optional(),
    dualReplyNudge: z.string().max(80).optional(),
    dualReplyNudgeMulti: z.record(z.string()).optional(),
    dualReplyNudgeVariations: z.record(z.array(z.string().max(80))).optional(),
    handoffPauseDurationMinutes: z.number().int().min(5).max(1440).optional(),
    commentEscalationMinutes: z.number().int().min(5, 'Minimum 5 minutes').max(1440, 'Maximum 24 hours').optional(),
    messageEscalationMinutes: z.number().int().min(5, 'Minimum 5 minutes').max(1440, 'Maximum 24 hours').optional(),
    notificationsEnabled: z.boolean().optional(),
    replyStyle: z.enum(['professional', 'casual', 'enthusiastic']).optional(),
    brandVoiceNotes: z.string().max(MAX_TEMPLATE_MESSAGE_LENGTH, `Brand voice notes must be ${MAX_TEMPLATE_MESSAGE_LENGTH} characters or fewer`).optional(),
    brandVoiceNotesMulti: z.record(z.string()).optional(),
    holdLowConfidence: z.boolean().optional(),
});

// ==========================================
// Plans (Admin)
// ==========================================
export const CreatePlanSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100),
    slug: z.string().min(1, 'Slug is required').max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
    description: z.string().max(500).optional(),
    price: z.number().int().min(0, 'Price must be non-negative'),
    currency: z.string().length(3).default('USD'),
    interval: z.enum(['month', 'year']).default('month'),
    maxPages: z.number().int().min(1).nullable().optional(),
    maxAiRepliesPerMonth: z.number().int().min(0).nullable().optional(),
    facebookEnabled: z.boolean().default(true),
    instagramEnabled: z.boolean().default(true),
    whatsappEnabled: z.boolean().default(false),
    showBranding: z.boolean().default(true),
    prioritySupport: z.boolean().default(false),
    trialDays: z.number().int().min(0).default(0),
    regionalPricing: z.record(z.string(), z.number()).optional(),
    isActive: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
});

export const UpdatePlanSchema = CreatePlanSchema.partial();

// ==========================================
// Business Profile
// ==========================================
export const BusinessProfileSchema = z.object({
    name: z.string().max(255).optional(),
    category: z.string().max(255).optional(),
    about: z.string().max(2000).optional(),
    phone: z.string().max(50).optional(),
    website: z.string().max(500).optional(),
    address: z.string().max(255).optional(),
    city: z.string().max(100).optional(),
    country: z.string().max(100).optional(),
    hours: z.record(
        z.string(),
        z.array(z.string().max(30))
    ).optional(),
    channels: z.object({
        preferred: z.enum(['dm', 'whatsapp', 'phone']).optional(),
        whatsapp: z.string().max(50).optional(),
    }).optional(),
    language_hint: z.enum(['ar', 'en']).optional(),
}).passthrough(); // Allow extra fields from Facebook API without breaking

export type BusinessProfileInput = z.infer<typeof BusinessProfileSchema>;

// ==========================================
// Generic ID Validation
// ==========================================
export const UUIDSchema = z.string().uuid('Invalid ID format');

export const PaginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ==========================================
// Validation Helpers
// ==========================================

/**
 * Format Zod validation errors for API response
 */
export function formatValidationErrors(errors: z.ZodError): { field: string; message: string }[] {
    return errors.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
    }));
}

/**
 * Validate and parse data with schema
 */
export function validateSchema<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; errors: { field: string; message: string }[] } {
    const result = schema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, errors: formatValidationErrors(result.error) };
}

// ==========================================
// Export Types
// ==========================================
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;
export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;

