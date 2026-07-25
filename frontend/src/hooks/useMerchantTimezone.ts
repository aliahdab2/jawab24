import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

/**
 * The workspace's configured timezone (`settings.timezone`).
 *
 * Read-only by design: the timezone is workspace-level (a merchant's pages are
 * in one country) and is already the source that drives the AI's "Today's date"
 * line and the Post-Reply business-hours gate. The hours editor DISPLAYS it for
 * context and links to Settings to change it — it must never offer a second
 * control, or one value gets two homes and they drift (see D-043).
 *
 * Returns undefined while loading / unauthenticated so callers can hide the
 * hint rather than show a wrong clock.
 */
export function useMerchantTimezone(): string | undefined {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data } = useQuery({
    queryKey: ['merchant-timezone'],
    queryFn: async (): Promise<string | undefined> => {
      const res = await settingsApi.get();
      return res.data?.timezone || undefined;
    },
    staleTime: 5 * 60 * 1000,
    enabled: isAuthenticated,
  });
  return data;
}
