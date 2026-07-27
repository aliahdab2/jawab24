import * as Sentry from '@sentry/node';

/** An error carrying its own Sentry tags. See `tagError`. */
interface TaggedError extends Error {
  sentryTags?: Record<string, string>;
}

/**
 * Attach Sentry tags TO an error so they travel with it to whatever eventually
 * reports it.
 *
 * Use this instead of a bare `Sentry.setTag()` before a `throw`. A bare
 * `setTag` writes to the *ambient* scope, and most of this codebase's throwing
 * happens in BullMQ workers and cron jobs where there is no per-request
 * isolation scope — so the tag lands on the process-wide scope and then rides
 * along on every UNRELATED event reported afterwards.
 *
 * That is not theoretical: an `aiErrorClass: AiRefusalError` tag was observed in
 * production attached to a `POST /pages/:id/connect-whatsapp` stream error
 * (Sentry JAWAB24-BACKEND-1H, 2026-07-27) — a request that has nothing to do
 * with the AI pipeline. During an incident that sends whoever is on call to the
 * wrong subsystem.
 *
 * Process-wide constants (`service`, `release`) are the legitimate exception and
 * are still set globally at init in `lib/sentry.ts`.
 */
export function tagError<E extends Error>(error: E, tags: Record<string, string>): E {
  const target = error as TaggedError;
  target.sentryTags = { ...target.sentryTags, ...tags };
  return error;
}

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
  // Tags the error carried (see `tagError`) merge with the call site's own.
  // Call-site tags win — the reporter knows more about the context than the
  // thrower did.
  const carried = (err as TaggedError).sentryTags;
  const tags = carried || context?.tags ? { ...carried, ...context?.tags } : undefined;
  Sentry.captureException(err, {
    level: context?.level,
    tags,
    fingerprint: context?.fingerprint,
    extra: {
      ...context?.extra,
      ...(error instanceof Error ? {} : { originalError: error }),
    },
  });
}
