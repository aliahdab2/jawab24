/**
 * Shared probe harness — the transport half of every fabrication battery.
 *
 * WHY IT EXISTS
 * -------------
 * `place-fabrication-probe.ts` and `schedule-fabrication-probe.ts` each carried
 * byte-identical copies of `mapPool`, `ask`, and the demo-page resolver, plus
 * the same three type declarations. The duplication gate could not see them —
 * it scans the four `src` trees, not `scripts/` — so Rule 10.8 was the only
 * thing standing, and a third battery would have made three copies. Behaviour
 * here is EXACTLY what those two scripts had; nothing was "improved" in the
 * move, so their measurements stay comparable across the refactor.
 *
 * What deliberately did NOT move: the probe lists, the judging source
 * assembly, and each battery's reporting. Those are the experiment; this is
 * the plumbing.
 */

export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
export const RUNS = parseInt(process.env.RUNS || '4', 10);
export const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);

/** One turn of planted conversation history. */
export interface Turn { q: string | null; a: string | null }

/** The playground's response, tolerant of both the wrapped and bare shapes. */
export interface PlaygroundResponse {
    success?: boolean;
    data?: { reply: string | null; intent: string | null; flags: string[]; needsAttention: boolean };
    reply?: string | null;
    intent?: string | null;
    flags?: string[];
    needsAttention?: boolean;
}

/** A row in the dataset `scripts/grounding-audit.ts --dataset` consumes. */
export interface DatasetRow {
    id: string;
    page_name: string | null;
    page_replies_30d: number;
    kb_source: 'exact' | 'reconstructed';
    kb: string;
    question: string;
    reply: string;
    intent: string | null;
    flag_reason: string | null;
    needs_attention: boolean | null;
    created_at: string;
    history: Turn[] | null;
}

/** Read a reply/intent/flags out of either response shape. */
export function unwrapPlayground(resp: PlaygroundResponse | null): {
    reply: string | null; intent: string | null; flags: string[]; needsAttention: boolean | null;
} {
    return {
        reply: resp?.data?.reply ?? resp?.reply ?? null,
        intent: resp?.data?.intent ?? resp?.intent ?? null,
        flags: resp?.data?.flags ?? resp?.flags ?? [],
        needsAttention: resp?.data?.needsAttention ?? resp?.needsAttention ?? null,
    };
}

/** Bounded-concurrency map. Preserves input order in the output. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            out[i] = await fn(items[i], i);
        }
    }));
    return out;
}

/** Resolve a demo page's internal id by its fixture name. */
export async function resolveDemoPageId(wantedName: string): Promise<string> {
    const res = await fetch(`${BASE_URL}/admin/pages`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
    if (!res.ok) throw new Error(`GET /admin/pages failed: HTTP ${res.status}`);
    const json = await res.json() as { success: boolean; data: { id: string; name: string }[] };
    const page = json.data?.find(p => p.name === wantedName);
    if (!page) throw new Error(`Demo page "${wantedName}" not found — seed demo data first (POST /auth/demo)`);
    return page.id;
}

/**
 * One generation through the production choke point. `source: 'eval'` bypasses
 * every cache, so each call is a fresh generation at production sampling.
 *
 * 429/5xx are retried: a hard failure counted as "no fabrication" would flatter
 * the result, so callers must treat a null as MISSING, never as clean.
 */
export async function askPlayground(
    pageId: string,
    probe: { id: string; question: string; history?: Turn[] },
): Promise<PlaygroundResponse | null> {
    const body: Record<string, unknown> = {
        pageId,
        question: probe.question,
        channel: 'dm',
        source: 'eval',
    };
    if (probe.history) {
        body.conversationHistory = probe.history.flatMap(t => [
            ...(t.q ? [{ role: 'user', content: t.q }] : []),
            ...(t.a ? [{ role: 'assistant', content: t.a }] : []),
        ]);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(`${BASE_URL}/admin/ai/playground`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
            body: JSON.stringify(body),
        });
        if (res.ok) return await res.json() as PlaygroundResponse;
        if (![429, 500, 502, 503, 504].includes(res.status)) {
            console.error(`[${probe.id}] HTTP ${res.status}: ${await res.text()}`);
            return null;
        }
        await new Promise(r => setTimeout(r, [2000, 8000, 20000][attempt]));
    }
    console.error(`[${probe.id}] gave up after retries`);
    return null;
}

/** Fail fast when the token is missing — every battery needs it. */
export function requireAdminToken(): void {
    if (!ADMIN_TOKEN) {
        console.error('ADMIN_TOKEN required (JWT from POST /auth/demo)');
        process.exit(1);
    }
}
