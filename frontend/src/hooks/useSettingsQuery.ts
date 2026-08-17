import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

/**
 * The ONE query key for `GET /settings`.
 *
 * Every consumer of workspace settings must read through {@link useSettingsQuery}
 * so react-query dedupes them into a single round-trip. Before this existed, six
 * call sites fetched the identical response under five different keys
 * (`lead-alerts-enabled`, `merchant-timezone`, `comment-reply-config`,
 * `handoff-pause-duration`, `dashboard-settings`, plus the settings page) — so a
 * dashboard load measurably issued `/api/settings` **twice**, and other screens
 * more. On a slow connection each of those cost a full round trip (~2 s at 3G
 * latency) for bytes the app already had.
 *
 * ⚠️ Anything that SAVES settings must invalidate this key, or the UI keeps
 * showing pre-save values. It is one key precisely so that cannot be half-done.
 */
export const SETTINGS_QUERY_KEY = ['settings'] as const;

/**
 * The `GET /settings` fields read through this shared query.
 *
 * Only the fields shared consumers actually use are declared — the settings PAGE
 * reads the full payload through its own imperative fetch (it manages a form
 * draft and dirty-checking, which react-query state would fight). Every field is
 * optional because the endpoint is untyped server-side (`settingsApi.get`) and an
 * older workspace row may omit any of them.
 *
 * Deliberately NOT an index signature: a consumer reading an undeclared field
 * should get a type error and add it here, rather than silently receiving `{}`.
 */
export interface SettingsResponseData {
  /** Gates the in-app new-lead toasts (useLeadAlertsEnabled). */
  newLeadAlertsEnabled?: boolean;
  /** Workspace timezone (useMerchantTimezone). */
  timezone?: string | null;
  /** Handoff pause length (useHandoffPauseDuration). */
  handoffPauseDurationMinutes?: number;
  /** Comment reply delivery mode (useCommentReplyMode). */
  commentReplyMode?: string;
  /** Per-language public nudge for dual mode (useCommentReplyMode). */
  dualReplyNudgeMulti?: unknown;
  /** Server capability: Post Reply image attachments available. */
  triggerImagesEnabled?: boolean;
  /** Auto-reply masters shown on the dashboard. */
  commentsAutoReply?: boolean;
  messagesAutoReply?: boolean;
  /** Drives the dashboard's onboarding/setup panel. */
  onboardingCompletedAt?: string | null;
}

/**
 * `null`, never `undefined`: react-query v5 rejects `undefined` as query data, so
 * a body-less response would throw and retry on every mount (the same trap
 * already documented in useMerchantTimezone).
 */
export type SettingsResponse = SettingsResponseData | null;

/**
 * Shared workspace-settings query. Gated on authentication: `/settings` 401s
 * without a session, and an unauthenticated fetch would burn a request plus
 * react-query retries on public pages.
 */
export function useSettingsQuery() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery<SettingsResponse>({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: async (): Promise<SettingsResponse> => {
      const res = await settingsApi.get();
      return (res.data as SettingsResponseData | undefined) ?? null;
    },
    staleTime: 5 * 60 * 1000,
    enabled: isAuthenticated,
  });
}
