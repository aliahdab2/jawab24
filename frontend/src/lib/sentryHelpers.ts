import * as Sentry from '@sentry/nextjs';
import axios from 'axios';

/**
 * Extract a structured backend error code from an unknown thrown value.
 *
 * Looks in two places:
 *   1. Axios error: `response.data.code` (most API calls go through axios)
 *   2. Custom Error with `backendCode` property (set by fetch-based callers)
 *
 * Returns undefined if no code is found.
 */
export function getBackendErrorCode(error: unknown): string | undefined {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { code?: string } | undefined)?.code;
  }
  if (error instanceof Error) {
    const code = (error as Error & { backendCode?: string }).backendCode;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * HTTP status behind a failed request, when there is one.
 *
 * Pairs with getBackendErrorCode: together they make a Sentry event answer
 * "which failure was this?" instead of grouping every axios rejection under one
 * "Request failed with status code 409". Was written out inline at each call
 * site; shared here so a new caller cannot forget it.
 */
export function getStatusCode(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

/** Errors that are expected during normal operation and should not be sent to Sentry. */
const IGNORED_ERRORS = [
  'Session expired',
];

function isIgnoredError(error: unknown): boolean {
  if (error instanceof Error) {
    return IGNORED_ERRORS.some((msg) => error.message.includes(msg));
  }
  return false;
}

/**
 * Capture an error to Sentry with consistent formatting.
 * Handles both Error objects and unknown throw types.
 * Skips expected errors listed in IGNORED_ERRORS.
 */
export function captureError(
  error: unknown,
  fallbackMessage: string,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    level?: 'error' | 'warning' | 'fatal';
  }
) {
  if (isIgnoredError(error)) return;

  const err = error instanceof Error ? error : new Error(fallbackMessage);
  Sentry.captureException(err, {
    level: context?.level,
    tags: context?.tags,
    extra: {
      ...context?.extra,
      ...(error instanceof Error ? {} : { originalError: error }),
    },
  });
}

/**
 * Report a failed request only when it is OUR fault or nobody's: a network
 * failure (no status behind it) at `warning`, a 5xx as an error.
 *
 * Every 4xx is an answer the caller is expected to handle — a 401 for an
 * anonymous visitor, a 409 on a replay, a 429 from the limiter, a 422 for a
 * plan that is not for sale — and reporting those fills Sentry with events
 * that describe correct behaviour. Callers map the 4xx `code` to a message
 * themselves and then hand everything else here.
 */
export function captureUnexpectedError(
  error: unknown,
  fallbackMessage: string,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }
): void {
  const status = getStatusCode(error);
  if (status === undefined) {
    captureError(error, fallbackMessage, { ...context, level: 'warning' });
  } else if (status >= 500) {
    captureError(error, fallbackMessage, context);
  }
}

/**
 * Detach the user context set at login (`store.setAuth`).
 *
 * Every place that drops a session must call this, or errors raised afterwards
 * are still attributed to whoever last signed in on this device — which is
 * actively misleading when the session ended precisely BECAUSE the tab stopped
 * belonging to that person (see authManager.clearLocalSession).
 */
export function clearSentryUser() {
  Sentry.setUser(null);
}

/**
 * Add a breadcrumb to Sentry for context without creating an event.
 * Use for non-critical errors that should appear in the trail of a real error.
 */
export function addErrorBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>
) {
  Sentry.addBreadcrumb({
    category,
    message,
    level: 'warning',
    data,
  });
}
