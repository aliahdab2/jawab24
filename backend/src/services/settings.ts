import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings, workspaceMembers } from '../db/schema';
import { UserSettings, UpdateSettingsDTO } from '../types';
import { DEFAULT_HANDOFF_PAUSE_MINUTES, DEFAULT_AI_MODEL } from '@jawab24/shared';
import { redis } from '../lib/redis';
import { workspaceSettingsService } from './workspaceSettings';
import { captureError } from '../utils/sentryHelpers';
import { PIPELINE_FIELDS } from './pipelineFields';

/** Cache TTL: 5 minutes. Settings change rarely; staleness is acceptable. */
const SETTINGS_CACHE_TTL = 300;
const cacheKey = (userId: string) => `settings:v1:${userId}`;

// Re-export for backward compatibility
export type { UserSettings, UpdateSettingsDTO };

import { t } from '../utils/i18n';
import { isWithinBusinessHours as isWithinBusinessHoursShared, resolveLanguage as resolveLanguageShared } from '../utils/settingsHelpers';

/** Default messages used as send-time fallback when all stored values are empty */
const DEFAULT_AWAY_MESSAGE: Record<string, string> = {
    ar: t('defaultAway', 'ar'),
    en: t('defaultAway', 'en'),
};

export class SettingsService {
    /**
     * Get user settings, creating default settings if they don't exist.
     * Results are cached in Redis for 5 minutes to reduce DB load on the
     * reply pipeline, which calls this multiple times per incoming message.
     */
    async getSettings(userId: string): Promise<UserSettings> {
        const key = cacheKey(userId);

        // Try cache first — fail open so a Redis outage never blocks replies
        try {
            const cached = await redis.get(key);
            if (cached) {
                return JSON.parse(cached) as UserSettings;
            }
        } catch {
            // Redis unavailable — fall through to DB
        }

        // DB fetch
        const existing = await db.query.settings.findFirst({
            where: eq(settings.userId, userId),
        });

        let result: UserSettings;
        if (existing) {
            result = this.mapToUserSettings(existing);
        } else {
            // Create default settings
            const [newSettings] = await db.insert(settings)
                .values({ userId })
                .returning();
            result = this.mapToUserSettings(newSettings);
        }

        // Populate cache — fail open
        try {
            await redis.set(key, JSON.stringify(result), 'EX', SETTINGS_CACHE_TTL);
        } catch {
            // Redis unavailable — continue without caching
        }

        return result;
    }

    /**
     * Update user settings and invalidate the cache so the next read
     * reflects the change immediately.
     *
     * Also syncs pipeline-relevant fields to workspaceSettings so the reply
     * pipeline (commentProcessor / messageProcessor) picks them up immediately,
     * regardless of whether this call comes from the HTTP controller or directly.
     */
    async updateSettings(userId: string, updates: UpdateSettingsDTO): Promise<UserSettings> {
        // Ensure settings exist
        await this.getSettings(userId);

        // Convert ISO string timestamps to Date objects for Drizzle
        const dbUpdates: Record<string, unknown> = { ...updates, updatedAt: new Date() };
        if (typeof dbUpdates.onboardingCompletedAt === 'string') {
            dbUpdates.onboardingCompletedAt = new Date(dbUpdates.onboardingCompletedAt as string);
        }

        const [updated] = await db.update(settings)
            .set(dbUpdates as typeof settings.$inferInsert)
            .where(eq(settings.userId, userId))
            .returning();

        const result = this.mapToUserSettings(updated);

        // Invalidate cache — next getSettings call will re-populate from DB
        try {
            await redis.del(cacheKey(userId));
        } catch {
            // Redis unavailable — cache expires naturally via TTL
        }

        // Sync pipeline fields to workspaceSettings so the reply pipeline sees them
        await this.syncPipelineFieldsToWorkspace(userId, updates);

        return result;
    }

    /**
     * Looks up the user's workspace and syncs any pipeline-relevant fields from
     * the update payload into workspaceSettings.
     * Fire-and-forget: failures are logged but never surfaced to the caller.
     */
    private async syncPipelineFieldsToWorkspace(userId: string, updates: UpdateSettingsDTO): Promise<void> {
        try {
            const pipelineUpdates = Object.fromEntries(
                PIPELINE_FIELDS
                    .filter(key => key in updates)
                    .map(key => [key, (updates as Record<string, unknown>)[key]])
            );
            if (Object.keys(pipelineUpdates).length === 0) return;

            // Each user currently belongs to exactly one workspace (owner role).
            // limit(1) is intentional — multi-workspace sync would require a separate migration.
            const memberships = await db
                .select({ workspaceId: workspaceMembers.workspaceId })
                .from(workspaceMembers)
                .where(eq(workspaceMembers.userId, userId))
                .limit(1);

            const workspaceId = memberships[0]?.workspaceId;
            if (!workspaceId) return;

            await workspaceSettingsService.updateSettings(workspaceId, pipelineUpdates);
        } catch (error) {
            // Never let a sync failure break the settings save
            captureError(error, 'syncPipelineFieldsToWorkspace failed', { tags: { context: 'settings', action: 'workspace-sync' }, extra: { userId } });
        }
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
                userSettings.businessHoursEnd,
                userSettings.timezone
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
                userSettings.businessHoursEnd,
                userSettings.timezone
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

        // Try the preferred language from JSONB first, then any other stored language, then default
        const multi = userSettings.awayMessageMulti || {};
        const primary = multi[preferred];
        const fallback = Object.values(multi).find(v => v && v !== primary) ?? null;

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

        // Greeting is only sent if the user explicitly set one — no default fallback.
        // (Unlike away message, greeting is optional and shouldn't be unsolicited.)
        const multi = userSettings.greetingMessageMulti || {};
        const primary = multi[preferred];
        const fallback = Object.values(multi).find(v => v && v !== primary) ?? null;

        return primary || fallback || userSettings.greetingMessage || null;
    }

    /**
     * Get the merchant's custom fallback message for when the monthly Smart Reply
     * quota is exhausted. Returns null when nothing is configured — caller falls
     * back to the hardcoded `commentFallback` / `messageFallback` translation.
     */
    async getLimitFallbackMessage(userId: string, detectedLanguage?: string): Promise<string | null> {
        const userSettings = await this.getSettings(userId);
        const preferred = this.resolveLanguage(userSettings, detectedLanguage);

        const multi = userSettings.limitFallbackMessageMulti || {};
        const primary = multi[preferred];
        const fallback = Object.values(multi).find(v => v && v !== primary) ?? null;

        return primary || fallback || null;
    }

    /**
     * Get the reply delay in seconds
     */
    async getReplyDelay(userId: string): Promise<number> {
        const userSettings = await this.getSettings(userId);
        return userSettings.replyDelay;
    }

    /**
     * Check if current time is within business hours in the user's timezone
     */
    private isWithinBusinessHours(start: string, end: string, timezone: string): boolean {
        return isWithinBusinessHoursShared(start, end, timezone);
    }

    private resolveLanguage(userSettings: UserSettings, detectedLanguage?: string): string {
        return resolveLanguageShared({
            autoDetectLanguage: userSettings.autoDetectLanguage,
            supportedLanguages: userSettings.supportedLanguages,
            defaultLanguage: userSettings.dashboardLanguage,
        }, detectedLanguage);
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
            aiModel: record.aiModel || DEFAULT_AI_MODEL,
            commentReplyMode: (record.commentReplyMode as 'public' | 'private' | 'dual') || 'public',
            commentsAutoReply: record.commentsAutoReply ?? true,
            messagesAutoReply: record.messagesAutoReply ?? true,
            dualReplyNudge: record.dualReplyNudge || '',
            businessHoursOnly: record.businessHoursOnly ?? false,
            businessHoursStart: record.businessHoursStart || '09:00',
            businessHoursEnd: record.businessHoursEnd || '18:00',
            timezone: record.timezone || 'Asia/Damascus',
            awayMessage: record.awayMessage ?? null,
            greetingMessage: record.greetingMessage ?? null,
            // Multilingual messages (JSONB)
            awayMessageMulti: record.awayMessageMulti || {},
            greetingMessageMulti: record.greetingMessageMulti || {},
            limitFallbackMessageMulti: record.limitFallbackMessageMulti || {},
            dualReplyNudgeMulti: record.dualReplyNudgeMulti || {},
            replyDelay: record.replyDelay ?? 0,
            commentEscalationMinutes: record.commentEscalationMinutes ?? 60,
            messageEscalationMinutes: record.messageEscalationMinutes ?? 30,
            handoffPauseDurationMinutes: record.handoffPauseDurationMinutes ?? DEFAULT_HANDOFF_PAUSE_MINUTES,
            replyStyle: (record.replyStyle as 'professional' | 'casual' | 'enthusiastic') || 'professional',
            brandVoiceNotes: record.brandVoiceNotes || '',
            brandVoiceNotesMulti: record.brandVoiceNotesMulti || {},
            holdLowConfidence: record.holdLowConfidence ?? false,
            notificationsEnabled: record.notificationsEnabled ?? true,
            onboardingCompletedAt: record.onboardingCompletedAt?.toISOString() ?? null,
        };
    }
}

export const settingsService = new SettingsService();










