import { useQuery } from '@tanstack/react-query';
import { DEFAULT_HANDOFF_PAUSE_MINUTES } from '@jawab24/shared';
import { settingsApi } from '@/lib/api';

/**
 * Returns the workspace's configured handoff pause duration in minutes.
 * This is the same value used by both explicit pauses (button) and implicit
 * handoff pauses (manual reply). Cached across the session.
 */
export function useHandoffPauseDuration(): number {
  const { data } = useQuery({
    queryKey: ['handoff-pause-duration'],
    queryFn: async () => {
      const res = await settingsApi.get();
      return res.data?.handoffPauseDurationMinutes ?? DEFAULT_HANDOFF_PAUSE_MINUTES;
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? DEFAULT_HANDOFF_PAUSE_MINUTES;
}
