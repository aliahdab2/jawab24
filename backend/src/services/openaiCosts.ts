/**
 * Read-only client for OpenAI's organization Costs API — the AUTHORITATIVE source
 * of "what OpenAI bills us". Requires an org ADMIN key (sk-admin-…) in
 * config.openaiAdmin.apiKey; a project key cannot read org costs.
 *
 * Security: the admin key is never logged and is stripped from any thrown/captured
 * error (see sanitizeError). Callers must never forward these rows to the frontend
 * with the key attached (rows carry no secret — only cost figures).
 */
import { config } from '../config';

const COSTS_URL = 'https://api.openai.com/v1/organization/costs';

/** One normalized daily cost row, ready to upsert into ai_cost_snapshots. */
export interface OpenAiCostRow {
    /** UTC day, YYYY-MM-DD. */
    usageDate: string;
    /** OpenAI api_key_id (drains the shared org credit wallet); '' when unattributed. */
    apiKeyId: string;
    /** Model parsed from the line item (e.g. 'gpt-4.1-mini-2025-04-14'); '' if none. */
    model: string;
    /** Full Costs-API line item (e.g. 'gpt-4.1-mini-2025-04-14, input'); '' if none. */
    lineItem: string;
    amountUsd: number;
}

interface CostsApiResult {
    amount?: { value?: string | number };
    api_key_id?: string | null;
    line_item?: string | null;
}
interface CostsApiBucket {
    start_time: number;
    results?: CostsApiResult[];
}
interface CostsApiPage {
    data?: CostsApiBucket[];
    has_more?: boolean;
    next_page?: string | null;
    error?: { message?: string };
}

/** True when an org admin key is configured (the snapshot cron no-ops otherwise). */
export function isOpenAiCostsConfigured(): boolean {
    return config.openaiAdmin.apiKey.length > 0;
}

/** Unix seconds → UTC YYYY-MM-DD (OpenAI buckets are UTC days). */
function toUtcDate(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** The line item embeds the model before the first comma (e.g. "gpt-4.1-mini, input"). */
function modelFromLineItem(lineItem: string): string {
    const comma = lineItem.indexOf(',');
    return (comma === -1 ? lineItem : lineItem.slice(0, comma)).trim();
}

/** Remove anything that could leak the admin key before an error is surfaced. */
function sanitizeError(err: unknown): Error {
    const msg = err instanceof Error ? err.message : String(err);
    // Defensive: scrub any bearer token that somehow made it into the message.
    return new Error(msg.replace(/Bearer\s+sk-[A-Za-z0-9_-]+/g, 'Bearer sk-***'));
}

/**
 * Fetch authoritative org costs for [startTime, endTime) (unix seconds), grouped by
 * api_key_id + line_item, as daily buckets. Loops has_more/next_page until drained.
 */
export async function fetchCostRows(opts: { startTime: number; endTime: number }): Promise<OpenAiCostRow[]> {
    if (!isOpenAiCostsConfigured()) {
        throw new Error('OpenAI admin key not configured (config.openaiAdmin.apiKey)');
    }

    const rows: OpenAiCostRow[] = [];
    let page: string | undefined;
    // Defensive cap: a 1d-bucket org-cost range over months × keys × line items
    // stays well under this; the loop exits on has_more=false long before.
    for (let i = 0; i < 200; i++) {
        const params = new URLSearchParams();
        params.set('start_time', String(opts.startTime));
        params.set('end_time', String(opts.endTime));
        params.set('bucket_width', '1d');
        params.set('limit', '180');
        params.append('group_by', 'api_key_id');
        params.append('group_by', 'line_item');
        if (page) params.set('page', page);

        let body: CostsApiPage;
        try {
            const res = await fetch(`${COSTS_URL}?${params.toString()}`, {
                headers: { Authorization: `Bearer ${config.openaiAdmin.apiKey}` },
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`OpenAI Costs API ${res.status}: ${text.slice(0, 200)}`);
            }
            body = await res.json() as CostsApiPage;
        } catch (err) {
            throw sanitizeError(err);
        }

        if (body.error) throw new Error(`OpenAI Costs API error: ${body.error.message ?? 'unknown'}`);

        for (const bucket of body.data ?? []) {
            const usageDate = toUtcDate(bucket.start_time);
            for (const r of bucket.results ?? []) {
                const raw = r.amount?.value;
                const amountUsd = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
                if (!Number.isFinite(amountUsd)) continue; // skip malformed rows, don't poison totals
                const lineItem = r.line_item ?? '';
                rows.push({
                    usageDate,
                    apiKeyId: r.api_key_id ?? '',
                    model: modelFromLineItem(lineItem),
                    lineItem,
                    amountUsd,
                });
            }
        }

        if (!body.has_more || !body.next_page) break;
        page = body.next_page;
    }

    return rows;
}
