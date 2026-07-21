import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { workspaces, workspaceMembers, settings as settingsTable } from '../db/schema';
import { redis } from '../lib/redis';
import { t } from '../utils/i18n';
import { captureError } from '../utils/sentryHelpers';
import { isWithinBusinessHours as isWithinBusinessHoursShared, resolveLanguage as resolveLanguageShared } from '../utils/settingsHelpers';
import type { WorkspaceSettings, LeadStagesConfig, LeadCustomFieldDef } from '@jawab24/shared';
import { DEFAULT_HANDOFF_PAUSE_MINUTES, DEFAULT_AI_MODEL, PLACEHOLDER_TIMEZONE, resolveEffectiveLeadStages, resolveEffectiveLeadFields } from '@jawab24/shared';
import { PIPELINE_FIELDS, type PipelineField } from './pipelineFields';

/**
 * Why auto-reply is or isn't active for a channel right now.
 *  - `on`         — reply normally
 *  - `off_master` — the merchant switched this channel off; stay silent
 *  - `off_hours`  — channel is on but we're outside business hours (D-034)
 */
export type AutoReplyState = 'on' | 'off_master' | 'off_hours';

/** Cache TTL: 5 minutes. Settings change rarely; staleness is acceptable. */
const SETTINGS_CACHE_TTL = 300;
const cacheKey = (workspaceId: string) => `workspace_settings:v1:${workspaceId}`;

/** Default workspace settings — applied when JSONB fields are empty. Exported so the
 *  new-signup-seed contract test can assert the read-time merge without a DB. */
export const DEFAULTS: WorkspaceSettings = {
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
    afterHoursSmartReply: true,
    // Must match the settings-table column default (see schema.ts) so a workspace
    // whose JSONB predates an explicit timezone reads the same value the row has.
    timezone: PLACEHOLDER_TIMEZONE,
    greetingMessageMulti: {},
    greetingMessageEnabled: false,
    awayMessageMulti: {},
    limitFallbackEnabled: false,
    limitFallbackMessageMulti: {},
    dualReplyNudgeMulti: {},
    dualReplyNudgeVariations: {},
    replyDelay: 3,
    commentEscalationMinutes: 60,
    messageEscalationMinutes: 30,
    handoffPauseDurationMinutes: DEFAULT_HANDOFF_PAUSE_MINUTES,
    replyStyle: 'professional',
    brandVoiceNotes: '',
    brandVoiceNotesMulti: {},
    holdLowConfidence: false,
};

/**
 * Explicit settings seeded into a NEW workspace's JSONB at signup
 * (auth.createDefaultWorkspace). Deliberately DIFFERENT from DEFAULTS: a
 * brand-new merchant must NOT auto-reply publicly before reviewing their
 * Business Info — a thin/auto-imported KB produced public "we don't know our
 * own prices" replies that churned a same-day trial (D-025). So auto-reply
 * starts OFF on both surfaces, and the comment mode is 'dual' so that when the
 * merchant does switch it on, the substantive answer goes to a private DM and
 * the public wall only ever gets a short nudge.
 *
 * Only NEW workspaces get these keys written into their JSONB. Existing
 * workspaces omit them, so the read-time merge ({ ...DEFAULTS, ...jsonb }) still
 * resolves them to DEFAULTS (true / true / 'public') — existing merchants are
 * byte-identical, untouched.
 *
 * Channel scope: `commentReplyMode` governs FB/IG comment replies only — WhatsApp
 * has no public comments, so it never consults it. `messagesAutoReply` is the
 * cross-channel DM switch (FB Messenger, IG DM, and WhatsApp), but WhatsApp stays
 * additionally gated by its own page-level `whatsappAutoReplyEnabled` (defaults
 * OFF), so a WhatsApp number never auto-replies until explicitly turned on.
 */
export const NEW_SIGNUP_SETTINGS_SEED: Partial<WorkspaceSettings> = {
    commentsAutoReply: false,
    messagesAutoReply: false,
    commentReplyMode: 'dual',
};

type LegacyRow = Partial<Record<PipelineField, unknown>>;

/**
 * If the workspace JSONB is missing pipeline fields that exist in the
 * legacy settings table (owner row), return them so getSettings can merge
 * AND persist back. Returns null when no drift is detected.
 */
async function detectLegacyDrift(
    workspaceId: string,
    jsonb: Partial<WorkspaceSettings>,
): Promise<Partial<WorkspaceSettings> | null> {
    const missing = PIPELINE_FIELDS.filter(k => !(k in jsonb));
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
     * Effective lead config for a page = per-page override ?? workspace default.
     * Accepts the already-fetched page row (the leads controller has it) so we
     * don't re-query the page. Reuses the Redis-cached getSettings for the
     * workspace base. The two slices resolve independently: a page can override
     * stages while still inheriting fields, or vice-versa.
     */
    async getEffectiveLeadConfig(
        workspaceId: string,
        page: { leadStages?: LeadStagesConfig | null; leadFields?: LeadCustomFieldDef[] | null },
    ): Promise<{ leadStages: LeadStagesConfig | undefined; leadFields: LeadCustomFieldDef[] }> {
        const ws = await this.getSettings(workspaceId);
        return {
            leadStages: resolveEffectiveLeadStages(page.leadStages, ws.leadStages),
            leadFields: resolveEffectiveLeadFields(page.leadFields, ws.leadFields),
        };
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
     * Get the merchant's custom fallback message for when the monthly Smart Reply
     * quota is exhausted. Returns null when nothing is configured — caller falls
     * back to the hardcoded `commentFallback` / `messageFallback` translation.
     */
    async getLimitFallbackMessage(workspaceId: string, detectedLanguage?: string): Promise<string | null> {
        const settings = await this.getSettings(workspaceId);
        const preferred = this.resolveLanguage(settings, detectedLanguage);

        const multi = settings.limitFallbackMessageMulti || {};
        const primary = multi[preferred];
        // Skip the `sourceLang` metadata key — handleSmartTranslation stores it
        // alongside language entries, so a naive Object.values() can leak it
        // (e.g. returning the literal "en" string) when only that key is set.
        const fallback = Object.entries(multi)
            .find(([k, v]) => k !== 'sourceLang' && v && v !== primary)?.[1] ?? null;

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
        return this.autoReplyStateFromSettings(settings, type) === 'on';
    }

    /**
     * Why auto-reply is (or isn't) active right now.
     *
     * `isAutoReplyEnabledFromSettings` collapses two very different situations
     * into one `false`: the merchant switched the channel OFF, versus the
     * channel is ON but we're outside business hours. D-034 treats them
     * differently for DMs — outside hours we can still answer with a Smart Reply
     * plus a follow-up note, whereas a master-off channel must stay silent. The
     * boolean wrapper above keeps every other caller (comments, Post Reply)
     * behaving exactly as before.
     */
    autoReplyStateFromSettings(settings: WorkspaceSettings, type: 'messages' | 'comments'): AutoReplyState {
        const flag = type === 'messages' ? settings.messagesAutoReply : settings.commentsAutoReply;
        if (!flag) return 'off_master';

        if (settings.businessHoursOnly && !this.isWithinBusinessHours(
            settings.businessHoursStart,
            settings.businessHoursEnd,
            settings.timezone,
        )) {
            return 'off_hours';
        }

        return 'on';
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
