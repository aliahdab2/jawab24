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
- ONE fact per distinct offering/attribute. Each "content" MUST stand alone — a customer reading only that line understands it. Never write "it", "this one", or reference earlier context.
- Write "title" and "content" in the SAME language as the input (Arabic input → Arabic output). Do NOT translate.
- Extract ONLY facts the merchant explicitly states. NEVER invent prices, dates, durations, or details. Do not guess.
- If a fact has a price, put it in BOTH "price" (as written) and inside "content".
- Ignore greetings, opinions, the customer's own guesses, and the business's contact-redirect lines.
- If the input states no concrete facts, return {"facts": []}.

Input:
<TEXT>`;

export class KbFactExtractor {
    /**
     * Extract clean structured facts from free text (a gap answer or a KB block).
     * Powers both the gap-fill write path and the one-time KB backfill.
     * Returns [] on any failure — extraction must never throw into its callers.
     */
    async extract(text: string, ctx: { userId: string; pageId?: string }): Promise<ExtractedFact[]> {
        const trimmed = (text || '').trim();
        if (!trimmed) return [];
        if (!config.openai?.apiKey) return [];

        const prompt = FACT_EXTRACTION_PROMPT.replace('<TEXT>', trimmed);

        // Same model-resolution guard as lead extraction: this is a JSON-mode SDK call, so a
        // non-OpenAI model id would 404 — fall back to the default.
        const resolved = await getModelForUser(ctx.userId);
        const model = resolved.startsWith('gpt-') ? resolved : DEFAULT_AI_MODEL;

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
                temperature: 0,
                max_tokens: 2000,
                response_format: { type: 'json_object' },
            });
        } catch (err) {
            captureError(err, 'KB fact extraction AI call failed', {
                tags: { service: 'kb-fact-extraction' }, extra: { pageId: ctx.pageId },
            });
            return [];
        }

        const content = response.choices[0]?.message?.content;
        if (!content) return [];

        try {
            const parsed = JSON.parse(content) as { facts?: Array<{ title?: unknown; content?: unknown; price?: unknown }> };
            if (!Array.isArray(parsed.facts)) return [];
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
            return [];
        }
    }
}

export const kbFactExtractor = new KbFactExtractor();
