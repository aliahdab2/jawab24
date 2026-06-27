import { UpdateSettingsSchema } from '@jawab24/shared';
import type { SettingsState } from './types';

/**
 * Strips the fields that live on `SettingsState` for the UI but are NOT part of
 * the `PUT /settings` contract, then validates against the shared
 * `UpdateSettingsSchema`.
 *
 * `UpdateSettingsSchema` is `.strict()`, so any key it doesn't recognise — the
 * server-owned `id`/`userId` (merged in from the GET response at runtime) or the
 * client-only `pushNotifications` — makes the backend reject the WHOLE payload
 * with a 400.
 *
 * Every path that PUTs settings (the Save button AND the inline LanguageSelector)
 * MUST funnel through here, so a future `SettingsState` field added without a
 * matching schema entry can't silently 400 one path while the other keeps
 * working. (Regression: the language switch sent the raw `settings` object and
 * always 400'd — see `LanguageSelector`.)
 *
 * Returns the Zod `safeParse` result so callers can branch on `.success` and use
 * the cleaned `.data` as the request body.
 */
export function buildSettingsUpdatePayload(settings: SettingsState) {
  const editable = { ...(settings as unknown as Record<string, unknown>) };
  delete editable.id;
  delete editable.userId;
  delete editable.pushNotifications;
  return UpdateSettingsSchema.safeParse(editable);
}
