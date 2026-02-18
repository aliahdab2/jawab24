import * as Sentry from '@sentry/nextjs';

/**
 * Capture an error to Sentry with consistent formatting.
 * Handles both Error objects and unknown throw types.
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
