/**
 * Settings Types
 *
 * Types for user settings and preferences.
 */

import type { ReplyMode } from '@jawab24/shared';

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
    /** Smart Reply comments: like the customer's comment after replying (Facebook only). */
    likeComments: boolean;
    commentsAutoReply: boolean;
    messagesAutoReply: boolean;
    dualReplyNudge: string | null;
    businessHoursOnly: boolean;
    businessHoursStart: string;
    businessHoursEnd: string;
    timezone: string;
    awayMessage: string | null;
    greetingMessage: string | null;
    /** Whether the greeting message is sent to new customers. Read-back was
     *  missing here, which made the settings-page toggle always render off. */
    greetingMessageEnabled: boolean;
    // Multilingual messages (JSONB)
    greetingMessageMulti?: Record<string, string> | null;
    awayMessageMulti?: Record<string, string> | null;
    /** Master switch — when false, no reply is sent at the monthly limit. */
    limitFallbackEnabled: boolean;
    /** Custom reply when the monthly Smart Reply quota is exhausted. Used only when limitFallbackEnabled is true. */
    limitFallbackMessageMulti?: Record<string, string> | null;
    dualReplyNudgeMulti?: Record<string, string> | null;
    dualReplyNudgeVariations?: Record<string, string[]> | null;
    brandVoiceNotesMulti?: Record<string, string> | null;
    replyDelay: number;
    commentEscalationMinutes: number;
    messageEscalationMinutes: number;
    handoffPauseDurationMinutes: number;
    replyStyle: 'professional' | 'casual' | 'enthusiastic';
    replyMode: ReplyMode;
    brandVoiceNotes: string;
    holdLowConfidence: boolean;
    notificationsEnabled: boolean;
    newLeadAlertsEnabled: boolean;
    onboardingCompletedAt: string | null;
}

export interface UpdateSettingsDTO {
    dashboardLanguage?: string;
    defaultReplyLanguage?: string;
    supportedLanguages?: string[];
    autoDetectLanguage?: boolean;
    aiEnabled?: boolean;
    aiModel?: string;
    commentReplyMode?: 'public' | 'private' | 'dual';
    likeComments?: boolean;
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
    limitFallbackEnabled?: boolean;
    limitFallbackMessageMulti?: Record<string, string> | null;
    dualReplyNudgeMulti?: Record<string, string> | null;
    dualReplyNudgeVariations?: Record<string, string[]> | null;
    brandVoiceNotesMulti?: Record<string, string> | null;
    replyDelay?: number;
    commentEscalationMinutes?: number;
    messageEscalationMinutes?: number;
    handoffPauseDurationMinutes?: number;
    replyStyle?: 'professional' | 'casual' | 'enthusiastic';
    replyMode?: ReplyMode;
    brandVoiceNotes?: string;
    holdLowConfidence?: boolean;
    notificationsEnabled?: boolean;
    newLeadAlertsEnabled?: boolean;
    onboardingCompletedAt?: string | null;
}
