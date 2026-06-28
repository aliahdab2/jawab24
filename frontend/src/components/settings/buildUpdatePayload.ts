import { UpdateSettingsSchema } from '@jawab24/shared';
import type { SettingsState } from './types';

/**
 * Fields that live on `SettingsState` for the UI but are NOT part of the
 * `PUT /settings` contract: the server-owned `id`/`userId` (merged in from the
 * GET response at runtime) and the client-only `pushNotifications`.
 *
 * `UpdateSettingsSchema` is `.strict()`, so any of these in the body makes the
 * backend reject the WHOLE request with a 400 — they must be stripped first.
 */
const NON_SCHEMA_FIELDS = ['id', 'userId', 'pushNotifications'];

/**
 * Strips the non-schema fields and validates the whole object against
 * `UpdateSettingsSchema`. Returns the Zod `safeParse` result so callers can
 * branch on `.success` and use the cleaned `.data` as the request body.
 */
export function buildSettingsUpdatePayload(settings: SettingsState) {
  const editable = { ...(settings as unknown as Record<string, unknown>) };
  for (const field of NON_SCHEMA_FIELDS) delete editable[field];
  return UpdateSettingsSchema.safeParse(editable);
}

/**
 * Returns only the fields that differ from the baseline, excluding non-schema
 * fields. Deep-compares via `JSON.stringify` (the JSONB `*Multi` fields are
 * objects).
 */
export function changedSettingsFields(
  current: SettingsState,
  baseline: SettingsState,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(current) as (keyof SettingsState)[]) {
    if (NON_SCHEMA_FIELDS.includes(key)) continue;
    if (JSON.stringify(current[key]) === JSON.stringify(baseline[key])) continue;
    changed[key] = current[key];
  }
  return changed;
}

/**
 * Validates ONLY the fields the user changed (diff vs the baseline) for a Save.
 *
 * `PUT /settings` is a partial update, so Save must send a diff — not the whole
 * object. Sending everything made a save fail whenever ANY untouched stored
 * field violated the strict schema, e.g. a legacy `brandVoiceNotes` over the
 * 800-char cap blocking an unrelated edit (JAWAB24-FRONTEND-2J). Validating the
 * diff still surfaces inline errors for fields the user actually edited.
 *
 * Returns the Zod `safeParse` result; `.data` is the (possibly empty) validated
 * diff to send. An empty `.data` means nothing schema-relevant changed.
 */
export function buildChangedSettingsPayload(current: SettingsState, baseline: SettingsState) {
  return UpdateSettingsSchema.safeParse(changedSettingsFields(current, baseline));
}
