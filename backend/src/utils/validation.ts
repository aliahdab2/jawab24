import { z } from 'zod';

/**
 * Validation Schemas for API Requests
 * Using Zod for type-safe validation
 */

// ==========================================
// AI Generation
// ==========================================
export const AiGenerateSchema = z.object({
    comment: z.string()
        .min(1, 'Comment cannot be empty')
        .max(5000, 'Comment must be less than 5000 characters'),
    language: z.enum(['ar', 'en']).optional(),
    context: z.string().max(1000, 'Context must be less than 1000 characters').optional(),
});

// ==========================================
// Templates
// ==========================================
export const CreateTemplateSchema = z.object({
    name: z.string()
        .min(1, 'Template name is required')
        .max(100, 'Template name must be less than 100 characters'),
    message: z.string()
        .min(1, 'Template message is required')
        .max(1000, 'Template message must be less than 1000 characters'),
    active: z.boolean().default(true),
});

export const UpdateTemplateSchema = CreateTemplateSchema.partial();

// ==========================================
// Rules
// ==========================================
export const CreateRuleSchema = z.object({
    name: z.string()
        .min(1, 'Rule name is required')
        .max(100, 'Rule name must be less than 100 characters'),
    keywords: z.array(z.string())
        .min(1, 'At least one keyword is required')
        .max(50, 'Maximum 50 keywords allowed'),
    templateId: z.string().uuid('Invalid template ID'),
    priority: z.number().int().min(0).max(100).default(0),
    active: z.boolean().default(true),
});

export const UpdateRuleSchema = CreateRuleSchema.partial();

// ==========================================
// Pages
// ==========================================
export const UpdatePageSchema = z.object({
    autoReplyEnabled: z.boolean().optional(),
    instagramAutoReplyEnabled: z.boolean().optional(),
    knowledgeBase: z.string().max(10000, 'Knowledge base must be less than 10000 characters').optional(),
});

// ==========================================
// Settings
// ==========================================
export const UpdateSettingsSchema = z.object({
    dashboardLanguage: z.enum(['en', 'ar']).optional(),
    defaultReplyLanguage: z.enum(['en', 'ar']).optional(),
    supportedLanguages: z.array(z.enum(['en', 'ar'])).optional(),
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
    awayMessage: z.string().max(500, 'Away message must be less than 500 characters').optional(),
    awayMessageMulti: z.record(z.string()).optional(),
    replyDelay: z.number().int().min(0).max(300, 'Reply delay must be between 0-300 seconds').optional(),
    greetingMessage: z.string().max(500, 'Greeting message must be less than 500 characters').optional(),
    greetingMessageMulti: z.record(z.string()).optional(),
    commentReplyMode: z.enum(['public', 'private', 'dual']).optional(),
    dualReplyNudge: z.string().max(80).optional(),
    dualReplyNudgeMulti: z.record(z.string()).optional(),
    handoffPauseDurationMinutes: z.number().int().min(5).max(1440).optional(),
    commentEscalationMinutes: z.number().int().min(5, 'Minimum 5 minutes').max(1440, 'Maximum 24 hours').optional(),
    messageEscalationMinutes: z.number().int().min(5, 'Minimum 5 minutes').max(1440, 'Maximum 24 hours').optional(),
    notificationsEnabled: z.boolean().optional(),
});

// ==========================================
// Payment
// ==========================================
export const CreateCheckoutSessionSchema = z.object({
    planId: z.string().uuid('Invalid plan ID'),
    successUrl: z.string().url('Invalid success URL').optional(),
    cancelUrl: z.string().url('Invalid cancel URL').optional(),
});

// ==========================================
// Webhook
// ==========================================
export const WebhookVerificationSchema = z.object({
    'hub.mode': z.literal('subscribe'),
    'hub.verify_token': z.string(),
    'hub.challenge': z.string(),
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
    maxTemplates: z.number().int().min(0).nullable().optional(),
    maxRules: z.number().int().min(0).nullable().optional(),
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
export type AiGenerateInput = z.infer<typeof AiGenerateSchema>;
export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateSchema>;
export type CreateRuleInput = z.infer<typeof CreateRuleSchema>;
export type UpdateRuleInput = z.infer<typeof UpdateRuleSchema>;
export type UpdatePageInput = z.infer<typeof UpdatePageSchema>;
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;
export type CreateCheckoutSessionInput = z.infer<typeof CreateCheckoutSessionSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;
export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;

