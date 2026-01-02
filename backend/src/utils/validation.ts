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
    translations: z.object({
        en: z.string().optional(),
        ar: z.string().optional(),
    }).refine(
        (data) => data.en || data.ar,
        'At least one translation (en or ar) is required'
    ),
    keywords: z.array(z.string()).optional(),
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
    awayMessage: z.string().max(500, 'Away message must be less than 500 characters').optional(),
    replyDelay: z.number().int().min(0).max(300, 'Reply delay must be between 0-300 seconds').optional(),
    greetingMessage: z.string().max(500, 'Greeting message must be less than 500 characters').optional(),
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
// Generic ID Validation
// ==========================================
export const UUIDSchema = z.string().uuid('Invalid ID format');

export const PaginationSchema = z.object({
    page: z.string().transform(Number).pipe(z.number().int().min(1)).default('1'),
    limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).default('20'),
});

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

