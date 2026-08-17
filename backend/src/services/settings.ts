import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings, workspaceMembers } from '../db/schema';
import { UserSettings, UpdateSettingsDTO } from '../types';
import { DEFAULT_HANDOFF_PAUSE_MINUTES, DEFAULT_AI_MODEL } from '@jawab24/shared';
import { redis } from '../lib/redis';
import { workspaceSettingsService } from './workspaceSettings';
import { captureError } from '../utils/sentryHelpers';
import { PIPELINE_FIELDS, overlayWorkspaceFields } from './pipelineFields';
import { coerceMultiLang } from './multiLangTranslation';

/** Cache TTL: 5 minutes. Settings change rarely; staleness is acceptable. */
const SETTINGS_CACHE_TTL = 300;
const cacheKey = (userId: string) => `settings:v1:${userId}`;

/**
 * Normalize every multilingual JSONB field to a real object (see coerceMultiLang).
 * Applied on BOTH getSettings paths — the DB path (via mapToUserSettings) and the
 * Redis cache-hit path, which returns the parsed JSON directly and would otherwise
 * leak a double-encoded string straight to the reply pipeline / translate logic.
 */
function normalizeMultiFields(s: UserSettings): UserSettings {
    s.awayMessageMulti = coerceMultiLang(s.awayMessageMulti);
    s.greetingMessageMulti = coerceMultiLang(s.greetingMessageMulti);
    s.limitFallbackMessageMulti = coerceMultiLang(s.limitFallbackMessageMulti);
    s.dualReplyNudgeMulti = coerceMultiLang(s.dualReplyNudgeMulti);
    s.brandVoiceNotesMulti = coerceMultiLang(s.brandVoiceNotesMulti);
    return s;
}

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
     *
     * Pipeline-relevant fields are served from the workspace JSONB store —
     * the store the reply pipeline actually reads — so the API never reports
     * a state the pipeline doesn't run (D-026). The legacy table's own values
     * for those fields can diverge (e.g. the D-025 new-signup seed writes
     * auto-reply OFF only into the workspace store, while the legacy columns
     * default to ON); for every converged workspace the overlay is an
     * identity function, because all legacy writers sync to the workspace
     * store and the drift-heal converges the rest.
     */
    async getSettings(userId: string): Promise<UserSettings> {
        const key = cacheKey(userId);

        // Try cache first — fail open so a Redis outage never blocks replies
        try {
            const cached = await redis.get(key);
            if (cached) {
                return this.overlayWorkspacePipelineFields(
                    userId,
                    normalizeMultiFields(JSON.parse(cached) as UserSettings),
                );
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
        result = normalizeMultiFields(result);

        // Populate cache — fail open. The cache stores the un-overlaid legacy
        // record: workspace-side invalidation stays owned by
        // workspaceSettingsService, whose own 5-min cache bounds staleness.
        try {
            await redis.set(key, JSON.stringify(result), 'EX', SETTINGS_CACHE_TTL);
        } catch {
            // Redis unavailable — continue without caching
        }

        return this.overlayWorkspacePipelineFields(userId, result);
    }

    /**
     * Serve pipeline fields from the workspace store (the pipeline's read
     * target) over the legacy row. Fails open to the legacy values — a
     * workspace-store hiccup must never break a settings read.
     */
    private async overlayWorkspacePipelineFields(userId: string, result: UserSettings): Promise<UserSettings> {
        try {
            const workspaceId = await this.resolveWorkspaceId(userId);
            if (!workspaceId) return result;

            const workspaceSettings = await workspaceSettingsService.getSettings(workspaceId);
            // aiModel is excluded from the overlay — see WORKSPACE_OVERLAY_FIELDS.
            const overlaid = overlayWorkspaceFields(
                result as unknown as Record<string, unknown>,
                workspaceSettings as unknown as Record<string, unknown>,
            );
            // The workspace store can hold *Multi values copied verbatim from the
            // legacy row (drift-heal/backfill), including the double-encoded-string
            // shape — normalize AFTER overlaying so a string never reaches clients
            // (whose {...multi} spread would corrupt it into a char-indexed object).
            return normalizeMultiFields(overlaid as unknown as UserSettings);
        } catch (error) {
            captureError(error, 'overlayWorkspacePipelineFields failed', {
                tags: { context: 'settings', action: 'workspace-overlay' },
                extra: { userId },
            });
            return result;
        }
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
        // Ensure settings exist; the effective (overlaid) state also feeds the
        // aiEnabled clamp below.
        const current = await this.getSettings(userId);

        // D-029: aiEnabled is DERIVED (channels-OR) and the new UI has no
        // standalone master switch — but old clients (shipped mobile builds)
        // still send aiEnabled independently, and diff-based payloads can carry
        // it alone. Clamp on write so the zombie state (engine off + channels
        // on → canned comments, silent DMs, no UI indication) is unrepresentable
        // regardless of the writer:
        //  - {aiEnabled:false} with no channel fields = an old client's master-off;
        //    cascade to both channels to preserve its kill-switch intent;
        //  - anything else: recompute aiEnabled from the effective channel values.
        if (updates.aiEnabled !== undefined
            || updates.commentsAutoReply !== undefined
            || updates.messagesAutoReply !== undefined) {
            if (updates.aiEnabled === false
                && updates.commentsAutoReply === undefined
                && updates.messagesAutoReply === undefined) {
                updates = { ...updates, commentsAutoReply: false, messagesAutoReply: false };
            } else {
                const comments = updates.commentsAutoReply ?? current.commentsAutoReply;
                const messages = updates.messagesAutoReply ?? current.messagesAutoReply;
                updates = { ...updates, aiEnabled: comments || messages };
            }
        }

        // Convert ISO string timestamps to Date objects for Drizzle
        const dbUpdates: Record<string, unknown> = { ...updates, updatedAt: new Date() };
        if (typeof dbUpdates.onboardingCompletedAt === 'string') {
            dbUpdates.onboardingCompletedAt = new Date(dbUpdates.onboardingCompletedAt as string);
        }

        const [updated] = await db.update(settings)
            .set(dbUpdates as typeof settings.$inferInsert)
            .where(eq(settings.userId, userId))
            .returning();

        const result = normalizeMultiFields(this.mapToUserSettings(updated));

        // Invalidate cache — next getSettings call will re-populate from DB
        try {
            await redis.del(cacheKey(userId));
        } catch {
            // Redis unavailable — cache expires naturally via TTL
        }

        // Sync pipeline fields to workspaceSettings so the reply pipeline sees them
        await this.syncPipelineFieldsToWorkspace(userId, updates);

        // Read-after-write consistency: the sync above is awaited, so the
        // workspace store already reflects this update (D-026).
        return this.overlayWorkspacePipelineFields(userId, result);
    }

    /**
     * Resolve the user's (single) workspace. Shared by the pipeline-field sync
     * and the read-path overlay.
     * Each user currently belongs to exactly one workspace (owner role).
     * limit(1) is intentional — multi-workspace would require a separate migration.
     */
    /**
     * In-process memo for the userId→workspaceId mapping. The mapping is
     * effectively immutable (one workspace per user, created at signup), and
     * since the overlay runs on EVERY settings read — including Redis cache
     * hits — an uncached SELECT here would put a Postgres roundtrip on all hot
     * auth/profile paths. Only non-null results are cached so a user whose
     * workspace appears later isn't pinned to null; entries are one small
     * string per active user, so unbounded growth is not a concern.
     */
    private workspaceIdCache = new Map<string, string>();

    /** Reset the userId→workspaceId memo — the service is a singleton, so unit
     *  tests that re-mock the membership query must clear it between cases. */
    clearWorkspaceIdCache(): void {
        this.workspaceIdCache.clear();
    }

    /**
     * The workspace a settings write will sync pipeline fields to — the SAME
     * resolver syncPipelineFieldsToWorkspace uses. Any gate that must hold on
     * the write target (the reply-mode allowlist, finding H3) resolves through
     * THIS, never through a parallel resolution path: for a multi-membership
     * user the request's resolved workspace and this value can differ, and a
     * gate checked on one while the write lands on the other is a bypass.
     */
    async resolveWriteTargetWorkspaceId(userId: string): Promise<string | null> {
        return this.resolveWorkspaceId(userId);
    }

    private async resolveWorkspaceId(userId: string): Promise<string | null> {
        const cached = this.workspaceIdCache.get(userId);
        if (cached) return cached;
        const memberships = await db
            .select({ workspaceId: workspaceMembers.workspaceId })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.userId, userId))
            .limit(1);
        const workspaceId = memberships[0]?.workspaceId ?? null;
        if (workspaceId) this.workspaceIdCache.set(userId, workspaceId);
        return workspaceId;
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

            const workspaceId = await this.resolveWorkspaceId(userId);
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
        // Skip the `sourceLang` metadata key (see workspaceSettings.getLimitFallbackMessage).
        const fallback = Object.entries(multi)
            .find(([k, v]) => k !== 'sourceLang' && v && v !== primary)?.[1] ?? null;

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
            likeComments: record.likeComments ?? false,
            commentsAutoReply: record.commentsAutoReply ?? true,
            messagesAutoReply: record.messagesAutoReply ?? true,
            dualReplyNudge: record.dualReplyNudge || '',
            businessHoursOnly: record.businessHoursOnly ?? false,
            businessHoursStart: record.businessHoursStart || '09:00',
            businessHoursEnd: record.businessHoursEnd || '18:00',
            timezone: record.timezone || 'Asia/Damascus',
            awayMessage: record.awayMessage ?? null,
            greetingMessage: record.greetingMessage ?? null,
            greetingMessageEnabled: record.greetingMessageEnabled ?? false,
            // Multilingual messages (JSONB)
            awayMessageMulti: record.awayMessageMulti || {},
            greetingMessageMulti: record.greetingMessageMulti || {},
            limitFallbackEnabled: record.limitFallbackEnabled ?? false,
            limitFallbackMessageMulti: record.limitFallbackMessageMulti || {},
            dualReplyNudgeMulti: record.dualReplyNudgeMulti || {},
            replyDelay: record.replyDelay ?? 0,
            commentEscalationMinutes: record.commentEscalationMinutes ?? 60,
            messageEscalationMinutes: record.messageEscalationMinutes ?? 30,
            handoffPauseDurationMinutes: record.handoffPauseDurationMinutes ?? DEFAULT_HANDOFF_PAUSE_MINUTES,
            replyStyle: (record.replyStyle as 'professional' | 'casual' | 'enthusiastic') || 'professional',
            replyMode: record.replyMode === 'info' ? 'info' : 'sales',
            brandVoiceNotes: record.brandVoiceNotes || '',
            brandVoiceNotesMulti: record.brandVoiceNotesMulti || {},
            holdLowConfidence: record.holdLowConfidence ?? false,
            notificationsEnabled: record.notificationsEnabled ?? true,
            newLeadAlertsEnabled: record.newLeadAlertsEnabled ?? true,
            onboardingCompletedAt: record.onboardingCompletedAt?.toISOString() ?? null,
        };
    }
}

export const settingsService = new SettingsService();










