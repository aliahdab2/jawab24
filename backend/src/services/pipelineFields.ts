/**
 * Settings fields the reply pipeline reads from `workspaces.settings` JSONB.
 *
 * Single source of truth for the sync between the legacy per-user `settings`
 * table (UI write target) and the per-workspace JSONB column (pipeline read
 * target). Three callers depend on this list:
 *   - settings.ts: filters which fields trigger workspace sync on user save
 *   - workspaceSettings.ts: detects drift between JSONB and legacy on read
 *   - backfill-workspace-settings.ts: copies legacy → JSONB during recovery
 *
 * Adding a field here without updating those callers' behavior is fine — they
 * all use it as a filter list. Removing a field requires considering whether
 * pipeline reads should ignore stale JSONB values for it.
 */
export const PIPELINE_FIELDS = [
    'commentsAutoReply', 'messagesAutoReply', 'businessHoursOnly',
    'businessHoursStart', 'businessHoursEnd', 'timezone',
    'aiEnabled', 'aiModel', 'commentReplyMode', 'likeComments',
    'dualReplyNudge', 'dualReplyNudgeMulti', 'dualReplyNudgeVariations',
    'replyDelay', 'greetingMessageMulti', 'greetingMessageEnabled', 'awayMessageMulti',
    'limitFallbackEnabled', 'limitFallbackMessageMulti',
    'handoffPauseDurationMinutes', 'commentEscalationMinutes',
    'messageEscalationMinutes', 'defaultReplyLanguage',
    'supportedLanguages', 'autoDetectLanguage',
    'replyStyle', 'replyMode', 'brandVoiceNotes', 'brandVoiceNotesMulti', 'holdLowConfidence',
] as const;

export type PipelineField = typeof PIPELINE_FIELDS[number];

/**
 * Pipeline fields served from the workspace store when READING settings for
 * display (D-026) — the merchant settings API and the admin support console
 * both overlay these over the legacy per-user row, so what they show is what
 * the reply pipeline actually obeys.
 *
 * `aiModel` is deliberately EXCLUDED: the admin model override writes the
 * legacy `settings` table directly (services/admin/users.ts) and the pipeline
 * resolves the model from that same table via aiModelResolver — so for
 * `aiModel` the LEGACY store is authoritative and the workspace copy can be
 * stale. Overlaying it would misreport the model actually in use.
 */
export const WORKSPACE_OVERLAY_FIELDS = PIPELINE_FIELDS.filter(f => f !== 'aiModel');

/**
 * Copy the WORKSPACE_OVERLAY_FIELDS the workspace store defines onto a copy of
 * `base` — the single overlay loop shared by both display surfaces (the
 * merchant settings read path and the admin support console). Multilingual
 * normalization stays at each call site: the two surfaces carry different
 * shapes (full UserSettings with sourceLang metadata vs the console's subset
 * row).
 *
 * `onlyExistingKeys` restricts the overlay to keys `base` already carries —
 * the console's leak-guard, so nothing workspace-internal enters a payload
 * built from an explicit column subset.
 */
export function overlayWorkspaceFields<T extends Record<string, unknown>>(
    base: T,
    workspace: Record<string, unknown>,
    opts: { onlyExistingKeys?: boolean } = {},
): T {
    const overlaid: Record<string, unknown> = { ...base };
    for (const field of WORKSPACE_OVERLAY_FIELDS) {
        if (opts.onlyExistingKeys && !(field in overlaid)) continue;
        const value = workspace[field];
        if (value !== undefined) overlaid[field] = value;
    }
    return overlaid as T;
}
