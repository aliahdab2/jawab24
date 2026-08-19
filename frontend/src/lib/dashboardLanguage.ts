import { settingsApi } from './api';
import type { Language } from '@/i18n/hooks';

/**
 * Persist the merchant's dashboard language to `settings.dashboardLanguage`.
 *
 * That column is the ONLY language signal the backend has when it composes a
 * push notification (`getUserLanguage` in `services/notifications.ts`) — the
 * Zustand store lives in the WebView and is invisible to a server-side send.
 * So every authenticated, user-initiated language change must mirror itself
 * here, or a merchant reading an English dashboard keeps getting Arabic pushes.
 *
 * Patches ONLY the language. `PUT /settings` is a partial update, so sending the
 * whole settings object would make a one-field language switch depend on the
 * validity of EVERY other stored field — e.g. a `brandVoiceNotes` value that
 * predates the 800-char cap blocks it (JAWAB24-FRONTEND-2J).
 *
 * Rejects on failure; the caller decides whether that is fatal (settings screen:
 * surface it) or advisory (nav toggle: report and move on).
 */
export async function persistDashboardLanguage(lang: Language): Promise<void> {
  await settingsApi.update({ dashboardLanguage: lang });
}
