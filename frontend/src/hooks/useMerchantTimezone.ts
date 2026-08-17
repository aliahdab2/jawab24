import { useSettingsQuery } from './useSettingsQuery';

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
  const { data } = useSettingsQuery();
  const timezone = data?.timezone;
  return typeof timezone === 'string' && timezone ? timezone : undefined;
}
