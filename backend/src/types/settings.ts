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
    timezone: string;
    awayMessage: string | null;
    greetingMessage: string | null;
    // Multilingual messages (JSONB)
    greetingMessageMulti?: Record<string, string> | null;
    awayMessageMulti?: Record<string, string> | null;
    dualReplyNudgeMulti?: Record<string, string> | null;
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
    timezone?: string;
    awayMessage?: string | null;
    greetingMessage?: string | null;
    // Multilingual messages
    greetingMessageMulti?: Record<string, string> | null;
    awayMessageMulti?: Record<string, string> | null;
    dualReplyNudgeMulti?: Record<string, string> | null;
    replyDelay?: number;
    commentEscalationMinutes?: number;
    messageEscalationMinutes?: number;
    handoffPauseDurationMinutes?: number;
    notificationsEnabled?: boolean;
}
