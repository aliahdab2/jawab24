/**
 * On-demand ISR revalidation client.
 *
 * Calls the frontend's `/api/revalidate` endpoint so statically generated
 * pages (e.g. `/pricing`) reflect data changes immediately, instead of
 * waiting for the ISR window to rotate.
 *
 * Configured via `FRONTEND_REVALIDATE_URL` and `REVALIDATE_SECRET`. When
 * either is missing, calls log a notice and return — revalidation is a
 * cache-coherence optimization, never a correctness requirement, so a
 * misconfigured or unreachable frontend must not break backend writes.
 */

export async function revalidatePublicPages(paths: string[]): Promise<void> {
    if (paths.length === 0) return;

    const url = process.env.FRONTEND_REVALIDATE_URL;
    const secret = process.env.REVALIDATE_SECRET;
    if (!url || !secret) {
        console.warn(
            `[revalidation] FRONTEND_REVALIDATE_URL or REVALIDATE_SECRET not set — skipping revalidation of ${paths.join(', ')}`,
        );
        return;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-revalidate-secret': secret,
            },
            body: JSON.stringify({ paths }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            console.warn(
                `[revalidation] Frontend returned ${response.status} ${response.statusText} for paths ${paths.join(', ')}`,
            );
            return;
        }
        // Success path is silent — failures already log via console.warn above.
    } catch (err) {
        console.warn(
            `[revalidation] Request failed for paths ${paths.join(', ')}:`,
            err instanceof Error ? err.message : err,
        );
    }
}

/**
 * Paths that depend on the `plans` table. Triggered after any plan create /
 * update / delete and after the seed script reconciles the table on deploy.
 * Both default-locale and `/en` variants are revalidated explicitly because
 * Next.js i18n treats them as distinct entries in the ISR cache.
 */
export const PLAN_DEPENDENT_PATHS = ['/pricing', '/en/pricing'] as const;

/**
 * Convenience wrapper for the most common caller pattern — kicks off
 * revalidation of every plan-dependent page in a single call.
 */
export function revalidatePlanPages(): Promise<void> {
    return revalidatePublicPages([...PLAN_DEPENDENT_PATHS]);
}
