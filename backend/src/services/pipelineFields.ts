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
    'aiEnabled', 'aiModel', 'commentReplyMode',
    'dualReplyNudge', 'dualReplyNudgeMulti', 'dualReplyNudgeVariations',
    'replyDelay', 'greetingMessageMulti', 'greetingMessageEnabled', 'awayMessageMulti',
    'limitFallbackEnabled', 'limitFallbackMessageMulti',
    'handoffPauseDurationMinutes', 'commentEscalationMinutes',
    'messageEscalationMinutes', 'defaultReplyLanguage',
    'supportedLanguages', 'autoDetectLanguage',
    'replyStyle', 'brandVoiceNotes', 'brandVoiceNotesMulti', 'holdLowConfidence',
] as const;

export type PipelineField = typeof PIPELINE_FIELDS[number];
