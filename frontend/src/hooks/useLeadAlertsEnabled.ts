import { useSettingsQuery } from './useSettingsQuery';

/**
 * The user's `newLeadAlertsEnabled` preference («تنبيهات العملاء المحتملين الجدد»).
 *
 * The backend gates the FCM push on this setting, but the in-app lead toasts
 * fired from SSE events were ungated — so a merchant who turned the toggle OFF
 * kept getting instant notifications (prod report 2026-07-19). useSSE reads
 * this to gate the `lead:captured` / `lead:re_engaged` toasts; the settings
 * page invalidates `SETTINGS_QUERY_KEY` on save so a toggle takes effect
 * immediately, not after the stale window.
 *
 * Defaults to true (alerts on) while loading or unauthenticated — matches the
 * DB column default and the backend gate's `?? true`. `undefined !== false` is
 * true, so the loading state gives that default without a separate branch.
 */
export function useLeadAlertsEnabled(): boolean {
  const { data } = useSettingsQuery();
  return data?.newLeadAlertsEnabled !== false;
}
