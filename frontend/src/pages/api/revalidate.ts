/**
 * On-demand ISR revalidation endpoint.
 *
 * Triggered by the backend whenever data backing a statically generated page
 * changes (e.g. plan pricing/quotas) so the public page reflects the new state
 * immediately, without waiting for the ISR window to rotate.
 *
 * Auth: shared secret via `x-revalidate-secret` header. Request body:
 *   { "paths": ["/pricing", "/en/pricing"] }
 *
 * Returns per-path success/error so callers can log partial failures.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { timingSafeEqual } from 'crypto';

interface RevalidateBody {
    paths?: string[];
}

function secretsMatch(provided: unknown, expected: string): boolean {
    if (typeof provided !== 'string') return false;
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(providedBuf, expectedBuf);
}

interface RevalidateResult {
    path: string;
    revalidated: boolean;
    error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const expectedSecret = process.env.REVALIDATE_SECRET;
    if (!expectedSecret) {
        return res.status(500).json({ error: 'Revalidation is not configured' });
    }

    if (!secretsMatch(req.headers['x-revalidate-secret'], expectedSecret)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = req.body as RevalidateBody;
    const paths = Array.isArray(body?.paths) ? body.paths : [];
    if (paths.length === 0) {
        return res.status(400).json({ error: 'paths must be a non-empty array' });
    }

    const results: RevalidateResult[] = [];
    for (const path of paths) {
        if (typeof path !== 'string' || !path.startsWith('/')) {
            results.push({ path: String(path), revalidated: false, error: 'Path must start with /' });
            continue;
        }
        try {
            await res.revalidate(path);
            results.push({ path, revalidated: true });
        } catch (err) {
            results.push({
                path,
                revalidated: false,
                error: err instanceof Error ? err.message : 'Unknown error',
            });
        }
    }

    const allOk = results.every((r) => r.revalidated);
    return res.status(allOk ? 200 : 207).json({ results });
}
