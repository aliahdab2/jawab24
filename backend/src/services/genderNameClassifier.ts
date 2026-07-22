import type { TrackedOpenAI } from './openaiClient';

/**
 * Batch name→gender classification for the v53 gender-map backfill
 * (scripts/backfill-gender-map.ts).
 *
 * The fleet-learned map (genderMap.ts) warms passively from per-reply labels —
 * too slowly for long-tail Arabic first names (~88 names learned in 5 days vs
 * 500–800 DMs/day). This module classifies names ACTIVELY: one small model
 * call per batch of first names, memoized forever by the script in the same
 * Redis counters the passive path uses. It is model inference, not a
 * hand-maintained lexicon — the settled ruling (D-015) bans curated name
 * lists, not memoized model judgments.
 *
 * `unknown` is the safe answer and the prompt biases hard toward it: a name
 * classified m/f serves gender-bucketed cached replies to every future
 * customer with that name, while `unknown` merely keeps today's per-name
 * behavior (fresh personalized generation). Never guess.
 */

export type ClassifiedGender = 'm' | 'f' | 'unknown';

export interface NameClassification {
    name: string;
    gender: ClassifiedGender;
}

/** ~15 output tokens per name + JSON scaffolding; sized per batch in classifyNamesBatch. */
const OUTPUT_TOKENS_PER_NAME = 15;
const OUTPUT_TOKENS_SLACK = 200;

export function buildClassifierPrompt(names: readonly string[]): string {
    return [
        'You classify FIRST NAMES of customers of Arabic-speaking businesses by the grammatical gender the name implies for its bearer.',
        'For each input name, answer "m" (clearly a male personal name), "f" (clearly a female personal name), or "unknown".',
        'You MUST answer "unknown" for: unisex or ambiguous names (e.g. نور، جود), nicknames, business or shop names, words that are not personal names, emoji or decorated strings, and any name you are not certain about.',
        'Names may be Arabic script or Latin transliterations (e.g. "mohamed", "fatima").',
        'Answering "unknown" is always acceptable and never penalized. Never guess.',
        '',
        'Return ONLY a JSON object of this exact shape:',
        '{"classifications":[{"name":"<name exactly as given>","gender":"m|f|unknown"}]}',
        '',
        `Names to classify (JSON array): ${JSON.stringify(names)}`,
    ].join('\n');
}

/**
 * Parse one classifier response defensively. NEVER throws:
 * - names missing from the response come back as `unknown`
 * - hallucinated/extra names are dropped
 * - invalid gender values coerce to `unknown`
 * - unparseable JSON → every requested name is `unknown`
 * Duplicate echoes keep the first occurrence.
 */
export function parseClassifierResponse(
    content: string | null | undefined,
    requestedNames: readonly string[],
): NameClassification[] {
    const byName = new Map<string, ClassifiedGender>();

    if (content) {
        try {
            const parsed: unknown = JSON.parse(content);
            const list = (parsed as { classifications?: unknown }).classifications;
            if (Array.isArray(list)) {
                for (const entry of list) {
                    const name = (entry as { name?: unknown }).name;
                    const gender = (entry as { gender?: unknown }).gender;
                    if (typeof name !== 'string' || byName.has(name)) continue;
                    byName.set(name, gender === 'm' || gender === 'f' ? gender : 'unknown');
                }
            }
        } catch {
            // Unparseable → fall through; every name resolves to 'unknown' below.
        }
    }

    return requestedNames.map(name => ({ name, gender: byName.get(name) ?? 'unknown' }));
}

/**
 * Classify one batch of first names. The tracked client logs cost to
 * ai_usage_log and emits the standard lifecycle counters automatically.
 * Errors from the API propagate to the caller (the script decides whether to
 * abort or continue); a *successful* call always yields one entry per name.
 */
export async function classifyNamesBatch(
    client: TrackedOpenAI,
    model: string,
    names: readonly string[],
): Promise<NameClassification[]> {
    if (names.length === 0) return [];

    const response = await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        max_tokens: names.length * OUTPUT_TOKENS_PER_NAME + OUTPUT_TOKENS_SLACK,
        messages: [{ role: 'user', content: buildClassifierPrompt(names) }],
    });

    return parseClassifierResponse(response.choices[0]?.message?.content, names);
}
