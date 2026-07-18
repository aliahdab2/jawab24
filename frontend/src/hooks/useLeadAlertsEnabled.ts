import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

/**
 * The user's `newLeadAlertsEnabled` preference («تنبيهات العملاء المحتملين الجدد»).
 *
 * The backend gates the FCM push on this setting, but the in-app lead toasts
 * fired from SSE events were ungated — so a merchant who turned the toggle OFF
 * kept getting instant notifications (prod report 2026-07-19). useSSE reads
 * this to gate the `lead:captured` / `lead:re_engaged` toasts; the settings
 * page invalidates `['lead-alerts-enabled']` on save so a toggle takes effect
 * immediately, not after the stale window.
 *
 * Defaults to true (alerts on) while loading or unauthenticated — matches the
 * DB column default and the backend gate's `?? true`.
 */
export function useLeadAlertsEnabled(): boolean {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data } = useQuery({
    queryKey: ['lead-alerts-enabled'],
    queryFn: async (): Promise<boolean> => {
      const res = await settingsApi.get();
      return res.data?.newLeadAlertsEnabled !== false;
    },
    staleTime: 5 * 60 * 1000,
    enabled: isAuthenticated,
  });
  return data ?? true;
}
