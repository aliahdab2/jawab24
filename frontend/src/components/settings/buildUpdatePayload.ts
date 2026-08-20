import { UpdateSettingsSchema, MAX_BRAND_VOICE_LENGTH } from '@jawab24/shared';
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
  const changed = changedSettingsFields(current, baseline);

  // Heal a stale over-cap brandVoiceNotesMulti language. The textarea caps the
  // language being edited, but a previously machine-translated OTHER language can
  // exceed the cap (older data, before the backend clamp). Editing one language
  // resends the WHOLE object in the diff, so that stale value would fail schema
  // validation and dead-end the save. Clamp it here so the save proceeds; the
  // backend re-translates + re-clamps the edited language anyway. Backend
  // prevention (smartTranslateMultiLang maxLength) stops new over-cap values; this
  // is the client-side heal for rows that predate it.
  const multi = changed.brandVoiceNotesMulti;
  if (multi && typeof multi === 'object') {
    changed.brandVoiceNotesMulti = Object.fromEntries(
      Object.entries(multi as Record<string, unknown>).map(([lang, val]) => [
        lang,
        typeof val === 'string' ? val.slice(0, MAX_BRAND_VOICE_LENGTH) : val,
      ]),
    );
  }

  return UpdateSettingsSchema.safeParse(changed);
}

/**
 * "Is there unsaved input a TEST REPLY would be wrong about?" — the persona text
 * and the tone, which the prompt reads. Drives the persona card's Test button.
 *
 * ⚠️ Deliberately NOT "is anything unsaved". `hasChanges` on the settings page is
 * TRUE from the first render for any account whose stored timezone is still the
 * DB placeholder: the page resolves it to the device zone while the baseline
 * keeps the RAW stored value, on purpose, so the seeded zone reads as a saveable
 * pending change. That is 70 of 84 production accounts (2026-08-20) — gating the
 * preview on it left the button dead for most of the fleet at exactly the moment
 * GA introduced the control (D-087).
 *
 * The reply MODE is excluded on its own terms: the card sends it to the
 * playground explicitly, so an unsaved mode still produces a truthful preview.
 */
export function hasUnsavedReplyInput(settings: SettingsState, baseline: SettingsState): boolean {
    const FIELDS = ['replyStyle', 'brandVoiceNotes', 'brandVoiceNotesMulti'] as const;
    return FIELDS.some((key) => JSON.stringify(settings[key]) !== JSON.stringify(baseline[key]));
}
