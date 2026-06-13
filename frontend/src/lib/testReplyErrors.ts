/**
 * Classifies an error thrown by `pagesApi.testReply` into a user-facing category
 * so callers can show the right message. Shared by the pages "Test smart reply"
 * modal and the onboarding "Try a reply" step — both hit the same rate-limited,
 * quota-gated endpoint, so the axios-error mapping must not be duplicated.
 *
 * - `rateLimit`: HTTP 429 — the test-reply endpoint allows 10 requests/minute.
 * - `quota`:     HTTP 403 with code `AI_QUOTA_EXCEEDED` — monthly smart-reply cap hit.
 * - `generic`:   anything else (network, 5xx, 404, missing page). These are the
 *                only ones worth reporting to Sentry; rate-limit/quota are expected.
 */
export type TestReplyErrorKind = 'rateLimit' | 'quota' | 'generic';

export function classifyTestReplyError(err: unknown): TestReplyErrorKind {
  const axiosErr = err as { response?: { status?: number; data?: { code?: string } } } | null;
  const status = axiosErr?.response?.status;
  if (status === 429) return 'rateLimit';
  if (status === 403 && axiosErr?.response?.data?.code === 'AI_QUOTA_EXCEEDED') return 'quota';
  return 'generic';
}
