import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/i18n/hooks';
import { useIsDemoUser } from '@/features/demo/useDemoMode';
import { persistDashboardLanguage } from '@/lib/dashboardLanguage';
import { captureError } from '@/lib/sentryHelpers';
import { SETTINGS_QUERY_KEY, useSettingsQuery, type SettingsResponse } from './useSettingsQuery';

/**
 * Heals drift between the language the merchant is READING and the language
 * stored in `settings.dashboard_language`.
 *
 * Those are two different stores by design: the UI language lives in the
 * device-local Zustand store (or the URL locale on web), while the column is a
 * per-account server value. Several paths move one without the other — the
 * logged-out toggles on the login and public pages persist nothing, and the
 * nav-bar toggle's PUT is fire-and-forget, so it loses to an offline moment.
 *
 * Left unreconciled the divergence is not cosmetic: that column is the ONLY
 * language signal a server-side send has (see `lib/dashboardLanguage.ts` and
 * `backend/src/utils/recipientLanguage.ts`), so a merchant reading English keeps
 * receiving Arabic pushes and emails.
 *
 * The UI wins. What the merchant is looking at is the choice they last made and
 * can see; the column is a mirror of it that only a successful PUT updates.
 *
 * Writes at most once per language per mount and updates the shared cache in
 * place, so a failed or stale-cached PUT cannot turn into a write loop. The two
 * explicit writers (the nav toggle, the settings selector) may briefly overlap
 * with it on a manual switch — the same value, written twice, converging.
 *
 * Skipped for the demo session: that user row is SHARED by every demo visitor
 * and re-seeded with the visitor's locale on each visit, so healing it writes
 * one visitor's language onto the next one's row for no gain.
 */
export function useDashboardLanguageSync() {
  const { language } = useLanguage();
  const { data } = useSettingsQuery();
  const isDemoUser = useIsDemoUser();
  const queryClient = useQueryClient();
  const attempted = useRef<string | null>(null);

  const stored = data?.dashboardLanguage;

  useEffect(() => {
    // No settings loaded yet (unauthenticated, or still fetching), or the two
    // already agree — nothing to heal.
    if (!stored || stored === language) return;
    if (isDemoUser) return;
    if (attempted.current === language) return;
    attempted.current = language;

    void persistDashboardLanguage(language)
      .then(() => {
        // Keep every other reader of the shared query on the value we just
        // wrote, instead of refetching or leaving them on the stale one.
        queryClient.setQueryData<SettingsResponse>(SETTINGS_QUERY_KEY, (prev) =>
          prev ? { ...prev, dashboardLanguage: language } : prev,
        );
      })
      .catch((error) => {
        // Advisory: the UI language is client-owned and already correct. Retry
        // on the next mount rather than blocking or nagging the merchant.
        attempted.current = null;
        captureError(error, 'Failed to reconcile dashboard language', {
          tags: { hook: 'useDashboardLanguageSync' },
        });
      });
  }, [stored, language, isDemoUser, queryClient]);
}
