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
    commentReplyMode: 'public' | 'private';
    commentsAutoReply: boolean;
    messagesAutoReply: boolean;
    businessHoursOnly: boolean;
    businessHoursStart: string;
    businessHoursEnd: string;
    awayMessage: string | null;
    greetingMessage: string | null;
    replyDelay: number;
}

export interface UpdateSettingsDTO {
    dashboardLanguage?: string;
    defaultReplyLanguage?: string;
    supportedLanguages?: string[];
    autoDetectLanguage?: boolean;
    aiEnabled?: boolean;
    aiModel?: string;
    commentReplyMode?: 'public' | 'private';
    commentsAutoReply?: boolean;
    messagesAutoReply?: boolean;
    businessHoursOnly?: boolean;
    businessHoursStart?: string;
    businessHoursEnd?: string;
    awayMessage?: string | null;
    greetingMessage?: string | null;
    replyDelay?: number;
}
