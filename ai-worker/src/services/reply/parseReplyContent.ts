/**
 * The ONE place a model's raw completion text becomes a `ParsedReply`.
 *
 * Every OpenAI call site that produces a customer-facing reply goes through
 * here — the plain path (`openai.ts`), the failover provider path
 * (`providers/index.ts`) and both phases of the e-commerce tool path
 * (`ecommerceToolHandler.ts`). Until 2026-08-23 each of the four had its own
 * inline `try { JSON.parse } catch { … }` with DIFFERENT fallbacks, and three of
 * them fell back to the raw content. The tool path — which runs without
 * `response_format` (see `replySchema.ts` for the measured reason) — then sent
 * a customer `<reply text>\n\n{"reply":"…","intent":…}` verbatim, flagged clean.
 *
 * Contract: the raw content is NEVER the reply when it carries an envelope.
 *
 *   json      — parsed as-is.
 *   salvaged  — the text did not parse whole, but an embedded `{…"reply":"…"…}`
 *               object did: the envelope's `reply` IS the intended answer, so it
 *               is used (flag `json_salvaged`, so the shape stays countable).
 *               Discarding it — the old openai.ts behaviour — turned a correct
 *               reply into an `ai_empty_reply` needs_attention row.
 *   broken    — looks like an envelope (`{` or `"reply"` present) but nothing
 *               parses: reply is EMPTIED (flag `invalid_json`). The caller's
 *               empty-reply arbitration then throws, and the merchant is flagged
 *               — a half-envelope can carry prompt text and must not be sent.
 *   plain     — ordinary prose with no envelope at all: used as the reply. What
 *               it MEANS depends on whether the call site enforced the envelope
 *               (`envelopeEnforced` on the context):
 *                 · enforced (plain path, failover providers — `response_format`
 *                   json_schema): prose is impossible unless something is wrong,
 *                   so it is flagged `invalid_json` + `low`, the long-standing
 *                   fallback.
 *                 · NOT enforced (both e-commerce tool sites — no
 *                   `response_format`, because it suppresses tool calling, see
 *                   replySchema.ts): prose is a normal, correct answer. It is
 *                   used as-is with `medium` confidence and NO flag. Flagging it
 *                   was the regression of 2026-08-23: the shared parser shipped
 *                   with the strict fallback for every site, and within three
 *                   hours 10 correct Salla replies carried «خطأ في معالجة الرد»
 *                   + a needs_attention push (0 such flags in the 12,297 AI
 *                   replies of the week before). Pre-parser, that site had
 *                   accepted prose quietly for months.
 */
import type { ParsedReply } from './types';

export type ParseOutcome = 'json' | 'salvaged' | 'broken' | 'plain';

export interface ParsedReplyContent {
    parsed: ParsedReply;
    outcome: ParseOutcome;
}

/** Bound on how many `{` positions the salvage walk tries (from the end). */
const SALVAGE_MAX_CANDIDATES = 20;

function isEnvelope(value: unknown): value is ParsedReply {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        && typeof (value as { reply?: unknown }).reply === 'string';
}

function tryParseEnvelope(text: string): ParsedReply | null {
    try {
        const value: unknown = JSON.parse(text);
        return isEnvelope(value) ? value : null;
    } catch {
        return null;
    }
}

/**
 * Find an embedded envelope in text that did not parse whole. Walks `{`
 * positions from the END: a model that echoes its plain-text history writes
 * the prose first and the envelope last, and a doubled envelope's second copy
 * is the complete one. Each candidate is tried to the end of the text and to
 * the last `}`.
 */
function salvageEnvelope(content: string): ParsedReply | null {
    const lastClose = content.lastIndexOf('}');
    let from = content.length;
    for (let i = 0; i < SALVAGE_MAX_CANDIDATES; i++) {
        const open = content.lastIndexOf('{', from - 1);
        if (open < 0) return null;
        const whole = tryParseEnvelope(content.slice(open));
        if (whole) return whole;
        if (lastClose > open) {
            const toClose = tryParseEnvelope(content.slice(open, lastClose + 1));
            if (toClose) return toClose;
        }
        from = open;
    }
    return null;
}

function looksLikeEnvelope(content: string): boolean {
    return content.trimStart().startsWith('{') || content.includes('"reply"');
}

/** Where the content came from — only used to label the log line. */
export interface ParseReplyContext {
    pipeline?: string;
    /** `site` names the call site (`plain`, `tools_direct`, `tools_final`, `provider`). */
    site: string;
    /**
     * Did this call site make the model emit the envelope (`response_format`
     * json_schema)? Decides what plain prose means — see the `plain` outcome
     * above. Required, not defaulted: a new call site must say which it is.
     */
    envelopeEnforced: boolean;
    finishReason?: string;
}

/**
 * One structured log line per non-clean outcome. `invalid_json_reply` is the
 * pre-existing event name (keep it — dashboards grep for it); `salvaged` is a
 * new field on the same event so the two shapes stay countable side by side.
 */
function logNonCleanOutcome(outcome: ParseOutcome, content: string, ctx: ParseReplyContext): void {
    if (outcome !== 'broken' && outcome !== 'salvaged') return;
    console.log(JSON.stringify({
        event: 'invalid_json_reply',
        salvaged: outcome === 'salvaged',
        site: ctx.site,
        pipeline: ctx.pipeline,
        finishReason: ctx.finishReason,
        raw: content.slice(0, 300),
    }));
}

export function parseReplyContent(content: string, ctx: ParseReplyContext): ParsedReplyContent {
    const direct = tryParseEnvelope(content);
    if (direct) return { parsed: direct, outcome: 'json' };

    const salvaged = salvageEnvelope(content);
    if (salvaged) {
        logNonCleanOutcome('salvaged', content, ctx);
        return {
            parsed: { ...salvaged, flags: [...(salvaged.flags ?? []), 'json_salvaged'] },
            outcome: 'salvaged',
        };
    }

    if (looksLikeEnvelope(content)) {
        logNonCleanOutcome('broken', content, ctx);
        return {
            parsed: { reply: '', intent: 'UNKNOWN', confidence: 'low', flags: ['invalid_json'] },
            outcome: 'broken',
        };
    }

    return {
        parsed: ctx.envelopeEnforced
            ? { reply: content, intent: 'UNKNOWN', confidence: 'low', flags: ['invalid_json'] }
            : { reply: content, intent: 'UNKNOWN', confidence: 'medium', flags: [] },
        outcome: 'plain',
    };
}
