import { DEFAULT_HANDOFF_PAUSE_MINUTES } from '@jawab24/shared';
import { useSettingsQuery } from './useSettingsQuery';

/**
 * Returns the workspace's configured handoff pause duration in minutes.
 * This is the same value used by both explicit pauses (button) and implicit
 * handoff pauses (manual reply). Reads the shared settings query, so it costs no
 * request of its own.
 */
export function useHandoffPauseDuration(): number {
  const { data } = useSettingsQuery();
  const minutes = data?.handoffPauseDurationMinutes;
  return typeof minutes === 'number' ? minutes : DEFAULT_HANDOFF_PAUSE_MINUTES;
}
