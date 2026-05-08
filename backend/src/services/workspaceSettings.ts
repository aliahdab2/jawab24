import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { workspaces, workspaceMembers, settings as settingsTable } from '../db/schema';
import { redis } from '../lib/redis';
import { t } from '../utils/i18n';
import { captureError } from '../utils/sentryHelpers';
import { isWithinBusinessHours as isWithinBusinessHoursShared, resolveLanguage as resolveLanguageShared } from '../utils/settingsHelpers';
import type { WorkspaceSettings } from '@jawab24/shared';
import { DEFAULT_HANDOFF_PAUSE_MINUTES, DEFAULT_AI_MODEL } from '@jawab24/shared';

/** Cache TTL: 5 minutes. Settings change rarely; staleness is acceptable. */
const SETTINGS_CACHE_TTL = 300;
const cacheKey = (workspaceId: string) => `workspace_settings:v1:${workspaceId}`;

/** Default workspace settings — applied when JSONB fields are empty */
const DEFAULTS: WorkspaceSettings = {
    defaultReplyLanguage: 'ar',
    supportedLanguages: ['en', 'ar'],
    autoDetectLanguage: true,
    aiEnabled: true,
    aiModel: DEFAULT_AI_MODEL,
    commentReplyMode: 'public',
    dualReplyNudge: '',
    commentsAutoReply: true,
    messagesAutoReply: true,
    businessHoursOnly: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    timezone: 'Asia/Damascus',
    greetingMessageMulti: {},
    awayMessageMulti: {},
    dualReplyNudgeMulti: {},
    dualReplyNudgeVariations: {},
    replyDelay: 0,
    commentEscalationMinutes: 60,
    messageEscalationMinutes: 30,
    handoffPauseDurationMinutes: DEFAULT_HANDOFF_PAUSE_MINUTES,
    replyStyle: 'professional',
    brandVoiceNotes: '',
    brandVoiceNotesMulti: {},
    holdLowConfidence: false,
};

// TODO: extract PIPELINE_FIELDS to a shared constant — currently mirrored in
// settings.ts:10-21. Diverging the two lists silently breaks drift detection.
/** Pipeline fields the reply pipeline reads. Must mirror PIPELINE_FIELDS in settings.ts. */
const PIPELINE_FIELDS_FOR_DRIFT = [
    'commentsAutoReply', 'messagesAutoReply', 'businessHoursOnly',
    'businessHoursStart', 'businessHoursEnd', 'timezone',
    'aiEnabled', 'aiModel', 'commentReplyMode',
    'dualReplyNudge', 'dualReplyNudgeMulti', 'dualReplyNudgeVariations',
    'replyDelay', 'greetingMessageMulti', 'awayMessageMulti',
    'handoffPauseDurationMinutes', 'commentEscalationMinutes',
    'messageEscalationMinutes', 'defaultReplyLanguage',
    'supportedLanguages', 'autoDetectLanguage',
    'replyStyle', 'brandVoiceNotes', 'brandVoiceNotesMulti', 'holdLowConfidence',
] as const;

type LegacyRow = Partial<Record<typeof PIPELINE_FIELDS_FOR_DRIFT[number], unknown>>;

/**
 * If the workspace JSONB is missing pipeline fields that exist in the
 * legacy settings table (owner row), return them so getSettings can merge
 * AND persist back. Returns null when no drift is detected.
 */
async function detectLegacyDrift(
    workspaceId: string,
    jsonb: Partial<WorkspaceSettings>,
): Promise<Partial<WorkspaceSettings> | null> {
    const missing = PIPELINE_FIELDS_FOR_DRIFT.filter(k => !(k in jsonb));
    if (missing.length === 0) return null;

    const owners = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.role, 'owner'),
        ))
        .limit(1);
    const ownerId = owners[0]?.userId;
    if (!ownerId) return null;

    const [legacy] = await db
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.userId, ownerId))
        .limit(1) as unknown as [LegacyRow | undefined];
    if (!legacy) return null;

    const recovered: Partial<WorkspaceSettings> = {};
    for (const k of missing) {
        const v = legacy[k];
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' && v.length === 0) continue;
        (recovered as Record<string, unknown>)[k] = v;
    }
    return Object.keys(recovered).length > 0 ? recovered : null;
}

/** Default away message as send-time fallback when all stored values are empty */
const DEFAULT_AWAY_MESSAGE: Record<string, string> = {
    ar: t('defaultAway', 'ar'),
    en: t('defaultAway', 'en'),
};

export class WorkspaceSettingsService {
    /**
     * Get workspace settings from the JSONB column, with defaults applied.
     * Cached in Redis for 5 minutes.
     */
    async getSettings(workspaceId: string): Promise<WorkspaceSettings> {
        const key = cacheKey(workspaceId);

        // Try cache first — fail open
        try {
            const cached = await redis.get(key);
            if (cached) {
                return JSON.parse(cached) as WorkspaceSettings;
            }
        } catch {
            // Redis unavailable — fall through to DB
        }

        // DB fetch
        const [workspace] = await db
            .select({ settings: workspaces.settings })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .limit(1);

        if (!workspace) {
            return { ...DEFAULTS };
        }

        const raw = (workspace.settings ?? {}) as Partial<WorkspaceSettings>;

        // Defensive auto-resync: heal drift between this JSONB and the legacy
        // `settings` table (per-user owner row). Converges toward zero drift on
        // each read; fully idempotent once all pipeline fields are present.
        // Fire-and-forget the write so a slow DB never blocks the reply
        // pipeline's hot path.
        const drift = await detectLegacyDrift(workspaceId, raw).catch(err => {
            captureError(err, 'workspaceSettings drift detection failed', {
                tags: { service: 'workspace-settings', action: 'drift-detect' },
                extra: { workspaceId },
            });
            return null;
        });

        const merged: Partial<WorkspaceSettings> = drift ? { ...raw, ...drift } : raw;

        if (drift) {
            void db.update(workspaces)
                .set({ settings: merged as Record<string, unknown>, updatedAt: new Date() })
                .where(eq(workspaces.id, workspaceId))
                .catch(err => captureError(err, 'workspaceSettings drift auto-resync write failed', {
                    tags: { service: 'workspace-settings', action: 'drift-resync' },
                    extra: { workspaceId, recoveredFields: Object.keys(drift) },
                }));
        }

        const result: WorkspaceSettings = { ...DEFAULTS, ...merged };

        // Populate cache — fail open
        try {
            await redis.set(key, JSON.stringify(result), 'EX', SETTINGS_CACHE_TTL);
        } catch {
            // Redis unavailable — continue without caching
        }

        return result;
    }

    /**
     * Update workspace settings (partial merge into JSONB).
     * Invalidates cache.
     */
    async updateSettings(
        workspaceId: string,
        updates: Partial<WorkspaceSettings>,
    ): Promise<WorkspaceSettings> {
        // Get current settings
        const current = await this.getSettings(workspaceId);
        const merged = { ...current, ...updates };

        await db
            .update(workspaces)
            .set({
                settings: merged as Record<string, unknown>,
                updatedAt: new Date(),
            })
            .where(eq(workspaces.id, workspaceId));

        // Invalidate cache
        try {
            await redis.del(cacheKey(workspaceId));
        } catch {
            // Redis unavailable — cache expires via TTL
        }

        return merged;
    }

    /**
     * Check if auto-reply is enabled for comments, respecting business hours.
     */
    async isCommentsAutoReplyEnabled(workspaceId: string): Promise<boolean> {
        const settings = await this.getSettings(workspaceId);

        if (!settings.commentsAutoReply) return false;

        if (settings.businessHoursOnly) {
            return this.isWithinBusinessHours(
                settings.businessHoursStart,
                settings.businessHoursEnd,
                settings.timezone,
            );
        }

        return true;
    }

    /**
     * Check if auto-reply is enabled for messages, respecting business hours.
     */
    async isMessagesAutoReplyEnabled(workspaceId: string): Promise<boolean> {
        const settings = await this.getSettings(workspaceId);

        if (!settings.messagesAutoReply) return false;

        if (settings.businessHoursOnly) {
            return this.isWithinBusinessHours(
                settings.businessHoursStart,
                settings.businessHoursEnd,
                settings.timezone,
            );
        }

        return true;
    }

    /**
     * Get the away message in the best language for the customer.
     */
    async getAwayMessage(workspaceId: string, detectedLanguage?: string): Promise<string | null> {
        const settings = await this.getSettings(workspaceId);
        const preferred = this.resolveLanguage(settings, detectedLanguage);

        const multi = settings.awayMessageMulti || {};
        const primary = multi[preferred];
        const fallback = Object.values(multi).find(v => v && v !== primary) ?? null;

        return primary || fallback || DEFAULT_AWAY_MESSAGE[preferred] || DEFAULT_AWAY_MESSAGE['en'];
    }

    /**
     * Get the greeting message for new conversations.
     */
    async getGreetingMessage(workspaceId: string, detectedLanguage?: string): Promise<string | null> {
        const settings = await this.getSettings(workspaceId);
        const preferred = this.resolveLanguage(settings, detectedLanguage);

        const multi = settings.greetingMessageMulti || {};
        const primary = multi[preferred];
        const fallback = Object.values(multi).find(v => v && v !== primary) ?? null;

        return primary || fallback || null;
    }

    /**
     * Get the reply delay in seconds.
     */
    async getReplyDelay(workspaceId: string): Promise<number> {
        const settings = await this.getSettings(workspaceId);
        return settings.replyDelay;
    }

    /**
     * Synchronous check: is auto-reply enabled for messages or comments?
     * Accepts a pre-fetched WorkspaceSettings object to avoid redundant Redis calls.
     */
    isAutoReplyEnabledFromSettings(settings: WorkspaceSettings, type: 'messages' | 'comments'): boolean {
        const flag = type === 'messages' ? settings.messagesAutoReply : settings.commentsAutoReply;
        if (!flag) return false;

        if (settings.businessHoursOnly) {
            return this.isWithinBusinessHours(
                settings.businessHoursStart,
                settings.businessHoursEnd,
                settings.timezone,
            );
        }

        return true;
    }

    /**
     * Check if current time is within business hours.
     */
    private isWithinBusinessHours(start: string, end: string, timezone: string): boolean {
        return isWithinBusinessHoursShared(start, end, timezone);
    }

    private resolveLanguage(settings: WorkspaceSettings, detectedLanguage?: string): string {
        return resolveLanguageShared({
            autoDetectLanguage: settings.autoDetectLanguage,
            supportedLanguages: settings.supportedLanguages,
            defaultLanguage: settings.defaultReplyLanguage,
        }, detectedLanguage);
    }
}

export const workspaceSettingsService = new WorkspaceSettingsService();
