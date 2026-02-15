import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';
import { UserSettings, UpdateSettingsDTO } from '../types';

// Re-export for backward compatibility
export type { UserSettings, UpdateSettingsDTO };

/** Default messages used as send-time fallback when all stored values are empty */
const DEFAULT_AWAY_MESSAGE: Record<string, string> = {
    ar: 'شكراً لتواصلك معنا! نحن حالياً خارج أوقات العمل، وسنرد عليك في أقرب وقت ممكن.',
    en: 'Thanks for your message! We\'re currently away and will get back to you as soon as possible.',
};

const DEFAULT_GREETING_MESSAGE: Record<string, string> = {
    ar: 'أهلاً بك! كيف يمكنني مساعدتك؟',
    en: 'Welcome! How can I help you?',
};

export class SettingsService {
    /**
     * Get user settings, creating default settings if they don't exist
     */
    async getSettings(userId: string): Promise<UserSettings> {
        const existing = await db.query.settings.findFirst({
            where: eq(settings.userId, userId),
        });

        if (existing) {
            return this.mapToUserSettings(existing);
        }

        // Create default settings
        const [newSettings] = await db.insert(settings)
            .values({ userId })
            .returning();

        return this.mapToUserSettings(newSettings);
    }

    /**
     * Update user settings
     */
    async updateSettings(userId: string, updates: UpdateSettingsDTO): Promise<UserSettings> {
        // Ensure settings exist
        await this.getSettings(userId);

        const [updated] = await db.update(settings)
            .set({
                ...updates,
                updatedAt: new Date(),
            })
            .where(eq(settings.userId, userId))
            .returning();

        return this.mapToUserSettings(updated);
    }

    /**
     * Check if auto-reply is enabled for comments
     */
    async isCommentsAutoReplyEnabled(userId: string): Promise<boolean> {
        const userSettings = await this.getSettings(userId);

        if (!userSettings.commentsAutoReply) {
            return false;
        }

        // Check business hours if enabled
        if (userSettings.businessHoursOnly) {
            return this.isWithinBusinessHours(
                userSettings.businessHoursStart,
                userSettings.businessHoursEnd
            );
        }

        return true;
    }

    /**
     * Check if auto-reply is enabled for messages
     */
    async isMessagesAutoReplyEnabled(userId: string): Promise<boolean> {
        const userSettings = await this.getSettings(userId);

        if (!userSettings.messagesAutoReply) {
            return false;
        }

        // Check business hours if enabled
        if (userSettings.businessHoursOnly) {
            return this.isWithinBusinessHours(
                userSettings.businessHoursStart,
                userSettings.businessHoursEnd
            );
        }

        return true;
    }

    /**
     * Get the away message if auto-reply is disabled or outside business hours.
     * Respects user's autoDetectLanguage and defaultReplyLanguage settings.
     *
     * @param userId - User ID
     * @param detectedLanguage - The customer's detected language (raw from detector)
     */
    async getAwayMessage(userId: string, detectedLanguage?: string): Promise<string | null> {
        const userSettings = await this.getSettings(userId);
        const preferred = this.resolveLanguage(userSettings, detectedLanguage);

        // Try the preferred language from JSONB first, then other language, then default
        const multi = userSettings.awayMessageMulti || {};
        const primary = multi[preferred];
        const fallback = multi[preferred === 'ar' ? 'en' : 'ar'];

        return primary || fallback || userSettings.awayMessage || DEFAULT_AWAY_MESSAGE[preferred] || DEFAULT_AWAY_MESSAGE['en'];
    }

    /**
     * Get the greeting message for new conversations.
     * Respects user's autoDetectLanguage and defaultReplyLanguage settings.
     *
     * @param userId - User ID
     * @param detectedLanguage - The customer's detected language (raw from detector)
     */
    async getGreetingMessage(userId: string, detectedLanguage?: string): Promise<string | null> {
        const userSettings = await this.getSettings(userId);
        const preferred = this.resolveLanguage(userSettings, detectedLanguage);

        // Try the preferred language from JSONB first, then other language, then default
        const multi = userSettings.greetingMessageMulti || {};
        const primary = multi[preferred];
        const fallback = multi[preferred === 'ar' ? 'en' : 'ar'];

        return primary || fallback || userSettings.greetingMessage || DEFAULT_GREETING_MESSAGE[preferred] || DEFAULT_GREETING_MESSAGE['en'];
    }

    /**
     * Get the reply delay in seconds
     */
    async getReplyDelay(userId: string): Promise<number> {
        const userSettings = await this.getSettings(userId);
        return userSettings.replyDelay;
    }

    /**
     * Check if current time is within business hours
     */
    private isWithinBusinessHours(start: string, end: string): boolean {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        // Simple string comparison works for HH:MM format
        return currentTime >= start && currentTime <= end;
    }

    /**
     * Resolves which stored language version to use.
     *
     * - If autoDetectLanguage is ON and a detected language was provided:
     *     Arabic → 'ar', anything else → defaultReplyLanguage
     * - If autoDetectLanguage is OFF or no detection provided:
     *     Uses dashboardLanguage from user settings as the fallback
     */
    private resolveLanguage(userSettings: UserSettings, detectedLanguage?: string): 'ar' | 'en' {
        const fallback = (userSettings.dashboardLanguage === 'ar' ? 'ar' : 'en') as 'ar' | 'en';

        if (!userSettings.autoDetectLanguage || !detectedLanguage || detectedLanguage === 'unknown') {
            return fallback;
        }

        return detectedLanguage === 'ar' ? 'ar' : fallback;
    }

    /**
     * Map database record to UserSettings interface
     */
    private mapToUserSettings(record: typeof settings.$inferSelect): UserSettings {
        return {
            id: record.id,
            userId: record.userId ?? '',
            dashboardLanguage: record.dashboardLanguage || 'ar',
            defaultReplyLanguage: record.defaultReplyLanguage || 'ar',
            supportedLanguages: record.supportedLanguages || ['en', 'ar'],
            autoDetectLanguage: record.autoDetectLanguage ?? true,
            aiEnabled: record.aiEnabled ?? true,
            aiModel: record.aiModel || 'gpt-4o-mini',
            commentReplyMode: (record.commentReplyMode as 'public' | 'private' | 'dual') || 'public',
            commentsAutoReply: record.commentsAutoReply ?? true,
            messagesAutoReply: record.messagesAutoReply ?? true,
            dualReplyNudge: record.dualReplyNudge || '',
            businessHoursOnly: record.businessHoursOnly ?? false,
            businessHoursStart: record.businessHoursStart || '09:00',
            businessHoursEnd: record.businessHoursEnd || '18:00',
            awayMessage: record.awayMessage ?? null,
            greetingMessage: record.greetingMessage ?? null,
            // Multilingual messages (JSONB)
            awayMessageMulti: record.awayMessageMulti || {},
            greetingMessageMulti: record.greetingMessageMulti || {},
            dualReplyNudgeMulti: record.dualReplyNudgeMulti || {},
            replyDelay: record.replyDelay ?? 0,
            commentEscalationMinutes: record.commentEscalationMinutes ?? 60,
            messageEscalationMinutes: record.messageEscalationMinutes ?? 30,
            handoffPauseDurationMinutes: record.handoffPauseDurationMinutes ?? 30,
            notificationsEnabled: record.notificationsEnabled ?? true,
        };
    }
}

export const settingsService = new SettingsService();










