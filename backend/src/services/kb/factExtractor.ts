import { makeTrackedOpenAI } from '../openaiClient';
import { config } from '../../config';
import { getModelForUser } from '../aiModelResolver';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';
import { captureError } from '../../utils/sentryHelpers';

/**
 * One fact the extractor produced from free text. `price` is split out (empty when none)
 * so the caller can gate price-bearing facts behind a merchant confirm (price-never-wrong).
 */
export interface ExtractedFact {
    title: string;
    content: string;
    price: string;
}

/**
 * Call context. `model` optionally pins a specific OpenAI model — used by the one-time KB
 * backfill to run a STRONGER model than the per-reply default (extraction accuracy sets reply
 * quality permanently; the backfill cost is paid once). Omit it for the prod gap-fill path,
 * which stays on the user's resolved (cheap) model.
 */
export interface FactExtractCtx {
    userId: string;
    pageId?: string;
    model?: string;
}

export const FACT_EXTRACTION_PROMPT = `You convert a merchant's business information into clean, STRUCTURED FACTS for an AI assistant's knowledge base.

The input is free text — either a short answer the merchant gave to a customer's question, or a block of their business info (which may be messy pasted chat logs).

Return ONLY valid JSON, no markdown, in this exact shape:
{
  "facts": [
    { "title": "<short name of the offering/attribute — a course, product, 'address', 'working hours', etc.>",
      "content": "<ONE self-contained factual sentence stating the fact clearly and completely>",
      "price": "<the price exactly as written (with currency if given), or empty string if this fact has no price>" }
  ]
}

Rules:
- ONE fact per distinct OFFERING (a course/product/service) or per top-level business ATTRIBUTE (address, working hours, policies). Each "content" MUST stand alone — a customer reading only that line understands it. Never write "it", "this one", or reference earlier context.
- Put ALL details of an offering — price, duration, schedule/days/times, start dates, level, mixed/non-mixed, conditions — INSIDE that one offering's "content". NEVER emit a separate fact for a schedule, a time slot, a start date, or a single attribute of an offering. One course = one fact, however many sessions or dates it has.
- Write "title" and "content" in the SAME language as the input (Arabic input → Arabic output). Do NOT translate.
- Extract ONLY facts the merchant explicitly states. NEVER invent prices, dates, durations, or details. Do not guess.
- If a fact has a price, put it in BOTH "price" (as written) and inside "content".
- Ignore greetings, opinions, the customer's own guesses, and the business's contact-redirect lines.
- If the input states no concrete facts, return {"facts": []}.

Input:
<TEXT>`;

export const FACT_CONSOLIDATION_PROMPT = `You are given a list of candidate business facts that were extracted PIECEMEAL from one merchant's knowledge base. Because each piece was read in isolation, the list contains DUPLICATES (the SAME offering captured more than once under slightly different names) and OVER-SPLIT entries. Your job is to return ONE clean, stable, canonical fact per real offering/attribute.

Return ONLY valid JSON, no markdown, in this exact shape:
{ "facts": [ { "title": "<clear, self-contained, disambiguated name>", "content": "<ONE self-contained factual sentence>", "price": "<price exactly as written, or empty string>" } ] }

Rules:
- MERGE candidates that describe the SAME offering/attribute into a SINGLE fact. Keep the most complete, clearest wording; do not lose any concrete detail (price, duration, schedule, conditions).
- FOLD attribute-only candidates (a schedule, a time slot, a start date, a single session of a course) INTO their parent offering's fact. The result must be ONE fact per offering that contains all its schedules/dates inline — never standalone "schedule"/"time"/"date" facts.
- KEEP genuinely DISTINCT offerings or levels SEPARATE, and give each a clear DISAMBIGUATED title that names the variant (e.g. "… - مبتدئ" / "… - متقدم" / "… - أونلاين"). A customer must be able to tell them apart from the title alone.
- PRICES ARE SACRED: never invent, change, round, or guess a price — copy it exactly. If two candidates describe the SAME offering but state DIFFERENT prices, that is a real conflict: do NOT merge them and do NOT pick one — keep them as separate, clearly-titled variants so the discrepancy is visible, never hidden.
- Drop exact/near duplicates. Preserve the input language (Arabic in → Arabic out). Do not translate.
- Output every distinct fact — do not summarize the list or drop offerings.

Candidate facts:
<FACTS>`;

export class KbFactExtractor {
    /**
     * Extract clean structured facts from free text (a gap answer or a KB block).
     * Powers both the gap-fill write path and the one-time KB backfill.
     * Returns [] on any failure — extraction must never throw into its callers.
     *
     * NOTE: for a whole (large) KB, call this per-segment for RECALL, then pass ALL the
     * candidates through `consolidate()` to dedupe/merge into a STABLE canonical set —
     * extracting a big KB piecemeal otherwise yields the same offering many times.
     */
    async extract(text: string, ctx: FactExtractCtx): Promise<ExtractedFact[]> {
        const trimmed = (text || '').trim();
        if (!trimmed) return [];
        const prompt = FACT_EXTRACTION_PROMPT.replace('<TEXT>', trimmed);
        return (await this.callFactsJson(prompt, ctx, 2000)) ?? [];
    }

    /**
     * Consolidate piecemeal candidate facts into ONE stable, canonical fact per offering:
     * merges duplicates (the same course captured under slightly different names), keeps
     * genuinely-distinct variants separate with disambiguated titles, and NEVER changes a
     * price (conflicting prices are kept as separate variants, never silently picked).
     *
     * This is what makes the extractor STABLE: without it, a big KB read in segments produces
     * duplicate/over-granular facts that (a) confuse the model with conflicting prices and
     * (b) bloat the retrieval pool so unique facts sink out of top-K.
     *
     * Graceful by construction: on ANY failure (AI error, bad/truncated JSON, empty result)
     * it returns the INPUT facts unchanged — consolidation can only ever improve, never lose.
     */
    async consolidate(facts: ExtractedFact[], ctx: FactExtractCtx): Promise<ExtractedFact[]> {
        if (facts.length <= 1) return facts;
        const payload = JSON.stringify({ facts: facts.map(f => ({ title: f.title, content: f.content, price: f.price })) });
        const prompt = FACT_CONSOLIDATION_PROMPT.replace('<FACTS>', payload);
        // Larger cap than extract(): the consolidated list can be long, and a truncated
        // (finish_reason=length) response is rejected by callFactsJson → we keep the originals.
        const result = await this.callFactsJson(prompt, ctx, 8000);
        return result && result.length > 0 ? result : facts;
    }

    /**
     * Shared JSON-mode OpenAI call for both extract and consolidate. Returns parsed facts, or
     * null on any failure (missing key, AI error, truncated/unparseable JSON) so each caller
     * can choose its own safe fallback. Never throws.
     */
    private async callFactsJson(
        prompt: string,
        ctx: FactExtractCtx,
        maxTokens: number,
    ): Promise<ExtractedFact[] | null> {
        if (!config.openai?.apiKey) return null;

        // A caller may pin a model (the backfill runs a stronger one). Otherwise resolve the
        // user's model. This is a JSON-mode SDK call, so a non-OpenAI model id would 404 —
        // guard with the gpt- prefix and fall back to the default.
        let model: string;
        if (ctx.model && ctx.model.startsWith('gpt-')) {
            model = ctx.model;
        } else {
            const resolved = await getModelForUser(ctx.userId);
            model = resolved.startsWith('gpt-') ? resolved : DEFAULT_AI_MODEL;
        }

        // Tracked client: ai_usage_log + the AI lifecycle counters are written automatically.
        const client = makeTrackedOpenAI(config.openai.apiKey, {
            userId: ctx.userId,
            pageId: ctx.pageId,
            pipeline: 'kb_fact_extraction',
        });

        let response;
        try {
            response = await client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0, // deterministic → stable fact set across runs
                max_tokens: maxTokens,
                response_format: { type: 'json_object' },
            });
        } catch (err) {
            captureError(err, 'KB fact extraction AI call failed', {
                tags: { service: 'kb-fact-extraction' }, extra: { pageId: ctx.pageId },
            });
            return null;
        }

        // A truncated response is cut-off JSON — unreliable. Reject so callers fall back.
        if (response.choices[0]?.finish_reason === 'length') {
            captureError(new Error('KB fact JSON truncated (finish_reason=length)'), 'KB fact extraction truncated', {
                tags: { service: 'kb-fact-extraction' }, extra: { pageId: ctx.pageId },
            });
            return null;
        }

        const content = response.choices[0]?.message?.content;
        if (!content) return null;

        try {
            const parsed = JSON.parse(content) as { facts?: Array<{ title?: unknown; content?: unknown; price?: unknown }> };
            if (!Array.isArray(parsed.facts)) return null;
            return parsed.facts
                .map(f => ({
                    // Length caps guard against pathological model output bloating a kb_fact row.
                    title: (typeof f.title === 'string' ? f.title.trim() : '').slice(0, 200),
                    content: (typeof f.content === 'string' ? f.content.trim() : '').slice(0, 1000),
                    price: (typeof f.price === 'string' ? f.price.trim() : '').slice(0, 60),
                }))
                .filter(f => f.content.length > 0);
        } catch (err) {
            captureError(err, 'KB fact extraction returned unparseable JSON', {
                tags: { service: 'kb-fact-extraction' }, extra: { pageId: ctx.pageId },
            });
            return null;
        }
    }
}

export const kbFactExtractor = new KbFactExtractor();
