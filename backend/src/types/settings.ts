/**
 * Settings Types
 * 
 * Types for user settings and preferences.
 */

export interface UserSettings {
    id: string;
    userId: string;
    dashboardLanguage: string;
    defaultReplyLanguage: string;
    supportedLanguages: string[];
    autoDetectLanguage: boolean;
    aiEnabled: boolean;
    aiModel: string;
    commentReplyMode: 'public' | 'private' | 'dual';
    commentsAutoReply: boolean;
    messagesAutoReply: boolean;
    dualReplyNudge: string;
    businessHoursOnly: boolean;
    businessHoursStart: string;
    businessHoursEnd: string;
    awayMessage: string | null; // DEPRECATED - use awayMessageAr/awayMessageEn
    greetingMessage: string | null; // DEPRECATED - use greetingMessageAr/greetingMessageEn
    // Multilingual messages
    awayMessageAr?: string | null;
    awayMessageEn?: string | null;
    greetingMessageAr?: string | null;
    greetingMessageEn?: string | null;
    awayMessageSourceLang?: 'ar' | 'en' | null;
    greetingMessageSourceLang?: 'ar' | 'en' | null;
    replyDelay: number;
    commentEscalationMinutes: number;
    messageEscalationMinutes: number;
    handoffPauseDurationMinutes: number;
    notificationsEnabled: boolean;
}

export interface UpdateSettingsDTO {
    dashboardLanguage?: string;
    defaultReplyLanguage?: string;
    supportedLanguages?: string[];
    autoDetectLanguage?: boolean;
    aiEnabled?: boolean;
    aiModel?: string;
    commentReplyMode?: 'public' | 'private' | 'dual';
    commentsAutoReply?: boolean;
    messagesAutoReply?: boolean;
    dualReplyNudge?: string;
    businessHoursOnly?: boolean;
    businessHoursStart?: string;
    businessHoursEnd?: string;
    awayMessage?: string | null; // DEPRECATED - use awayMessageAr/awayMessageEn
    greetingMessage?: string | null; // DEPRECATED - use greetingMessageAr/greetingMessageEn
    // Multilingual messages
    awayMessageAr?: string | null;
    awayMessageEn?: string | null;
    greetingMessageAr?: string | null;
    greetingMessageEn?: string | null;
    awayMessageSourceLang?: 'ar' | 'en' | null;
    greetingMessageSourceLang?: 'ar' | 'en' | null;
    replyDelay?: number;
    commentEscalationMinutes?: number;
    messageEscalationMinutes?: number;
    handoffPauseDurationMinutes?: number;
    notificationsEnabled?: boolean;
}
