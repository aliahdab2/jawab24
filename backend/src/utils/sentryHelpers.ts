import * as Sentry from '@sentry/node';

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
    /**
     * Stable fingerprint so high-frequency, expected failures (bad user media,
     * flaky third parties) group into ONE Sentry issue instead of flooding —
     * pair with `level: 'warning'` and alert on issue frequency.
     */
    fingerprint?: string[];
  }
) {
  const err = error instanceof Error ? error : new Error(fallbackMessage);
  Sentry.captureException(err, {
    level: context?.level,
    tags: context?.tags,
    fingerprint: context?.fingerprint,
    extra: {
      ...context?.extra,
      ...(error instanceof Error ? {} : { originalError: error }),
    },
  });
}
