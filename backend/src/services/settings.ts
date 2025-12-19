import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';

export interface UserSettings {
    id: string;
    userId: string;
    dashboardLanguage: string;
    defaultReplyLanguage: string;
    supportedLanguages: string[];
    autoDetectLanguage: boolean;
    aiEnabled: boolean;
    aiModel: string;
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
    commentsAutoReply?: boolean;
    messagesAutoReply?: boolean;
    businessHoursOnly?: boolean;
    businessHoursStart?: string;
    businessHoursEnd?: string;
    awayMessage?: string | null;
    greetingMessage?: string | null;
    replyDelay?: number;
}

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
     * Get the away message if auto-reply is disabled or outside business hours
     */
    async getAwayMessage(userId: string): Promise<string | null> {
        const userSettings = await this.getSettings(userId);
        return userSettings.awayMessage;
    }

    /**
     * Get the greeting message for new conversations
     */
    async getGreetingMessage(userId: string): Promise<string | null> {
        const userSettings = await this.getSettings(userId);
        return userSettings.greetingMessage;
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
     * Map database record to UserSettings interface
     */
    private mapToUserSettings(record: any): UserSettings {
        return {
            id: record.id,
            userId: record.userId,
            dashboardLanguage: record.dashboardLanguage || 'ar',
            defaultReplyLanguage: record.defaultReplyLanguage || 'ar',
            supportedLanguages: record.supportedLanguages || ['en', 'ar'],
            autoDetectLanguage: record.autoDetectLanguage ?? true,
            aiEnabled: record.aiEnabled ?? true,
            aiModel: record.aiModel || 'gpt-4o-mini',
            commentsAutoReply: record.commentsAutoReply ?? true,
            messagesAutoReply: record.messagesAutoReply ?? true,
            businessHoursOnly: record.businessHoursOnly ?? false,
            businessHoursStart: record.businessHoursStart || '09:00',
            businessHoursEnd: record.businessHoursEnd || '18:00',
            awayMessage: record.awayMessage,
            greetingMessage: record.greetingMessage,
            replyDelay: record.replyDelay ?? 0,
        };
    }
}

export const settingsService = new SettingsService();





