import { makeTrackedOpenAI } from './openaiClient';
import { config } from '../config';
import { redis } from '../lib/redis';
import { normalizeArabic, DEFAULT_AI_MODEL } from '@jawab24/shared';

/**
 * Addressee-gender transform for the dual-variant DM cache (D-033 follow-up).
 *
 * A gendered Arabic reply is reader-specific: «تفضّل» addresses a man,
 * «تفضّلي» a woman. To share ONE cache entry across all senders, the entry
 * stores BOTH renderings; this module produces the missing one via a small,
 * narrowly-scoped model call at save time ("convert the addressee's gender;
 * change nothing else") — an established Arabic-NLP task (user-aware gender
 * rewriting). It runs fire-and-forget on the save path, never on the
 * customer-facing request path: a failure just means this reply caches the
 * old way (per-name bucket), never a worse customer outcome.
 *
 * Content invariance is the safety property (external review finding): the
 * two renderings must differ ONLY in addressee morphology. A transform that
 * drops a clause or bends a price («٥٠»→«١٥») would serve corrupted content
 * on every future hit. Guards, cheapest first:
 *   1. digit-sequence equality — all numbers (Arabic-Indic normalized) must
 *      appear identically, in order. Prices are the catastrophic case.
 *   2. length-ratio bound — a rendering that grew or shrank beyond gendered
 *      morphology plausibly gained/lost content.
 * Failing either rejects the variant (counter, fallback to legacy save) —
 * detection, not correction, per the trust-the-model design (D-015: no
 * hand-maintained morphology rules; these checks are content equality, not
 * linguistic inspection).
 *
 * Dialect preservation cannot be checked in code (that WOULD be linguistic
 * inspection) — it is the transform eval's job (gate before enabling the
 * AI_DUAL_VARIANT_ENABLED flag in prod).
 */

export type AddresseeGender = 'm' | 'f';

/** Length-ratio bound for the invariance guard (gendered morphology adds/removes
 *  only suffix-scale characters; ±30% is generous for short replies). */
const LENGTH_RATIO_MIN = 0.7;
const LENGTH_RATIO_MAX = 1.4;

export function buildTransformPrompt(reply: string, target: AddresseeGender): string {
    const targetWord = target === 'f' ? 'feminine (مؤنث)' : 'masculine (مذكر)';
    return [
        `Rewrite the following customer-service reply so that it addresses the customer in the ${targetWord} grammatical gender.`,
        'Rules — follow ALL of them:',
        '- Change ONLY the words that grammatically address the customer (verbs, pronouns, suffixes directed at THEM).',
        '- Do NOT change anything else: keep the exact dialect and word choice, all numbers and prices EXACTLY as written, product names, emojis, punctuation, and line breaks.',
        '- Do NOT change the grammatical gender of products, third parties, or quoted text — only the addressee.',
        '- If the reply already addresses the customer in the requested gender or contains no addressee-directed gendered forms, return it unchanged.',
        '',
        'Return ONLY a JSON object: {"reply": "<the rewritten text>"}',
        '',
        `Reply to rewrite: ${JSON.stringify(reply)}`,
    ].join('\n');
}

/**
 * All digit runs in the text, with Arabic-Indic digits normalized, in order.
 * The invariance contract: both renderings must produce the same sequence.
 */
export function digitSequence(text: string): string[] {
    return normalizeArabic(text).match(/\d+/g) ?? [];
}

export type InvarianceViolation = 'numbers_changed' | 'length_drift';

/** Null when the variant is content-equivalent to the original; else the violation. */
export function invarianceViolation(original: string, variant: string): InvarianceViolation | null {
    const a = digitSequence(original);
    const b = digitSequence(variant);
    if (a.length !== b.length || a.some((d, i) => d !== b[i])) return 'numbers_changed';
    const ratio = variant.length / Math.max(1, original.length);
    if (ratio < LENGTH_RATIO_MIN || ratio > LENGTH_RATIO_MAX) return 'length_drift';
    return null;
}

/** Parse the transform response defensively; null on anything unusable. */
export function parseTransformResponse(content: string | null | undefined): string | null {
    if (!content) return null;
    try {
        const parsed: unknown = JSON.parse(content);
        const reply = (parsed as { reply?: unknown }).reply;
        return typeof reply === 'string' && reply.trim().length > 0 ? reply : null;
    } catch {
        return null;
    }
}

const counter = (name: string) => redis.incr(`metrics:cache:dual_variant:${name}`).catch(() => {});

/**
 * Produce the opposite-gender rendering of a reply, or null when it can't be
 * done safely (API error, unusable response, invariance violation, missing
 * config). All failures are absorbed here and counted — the caller treats
 * null as "cache this reply the legacy way". Cost lands in ai_usage_log under
 * pipeline 'gender_variant_transform' via the tracked client.
 */
export async function generateGenderVariant(opts: {
    userId: string;
    reply: string;
    /** Gender of the addressee in the EXISTING reply; the variant targets the opposite. */
    sourceGender: AddresseeGender;
}): Promise<string | null> {
    if (!config.openai.apiKey) {
        counter('save_reject:no_api_key');
        return null;
    }
    const target: AddresseeGender = opts.sourceGender === 'm' ? 'f' : 'm';

    try {
        const client = makeTrackedOpenAI(config.openai.apiKey, {
            userId: opts.userId,
            pipeline: 'gender_variant_transform',
        });
        const response = await client.chat.completions.create({
            model: DEFAULT_AI_MODEL,
            temperature: 0,
            response_format: { type: 'json_object' },
            // Variant ≈ original length; headroom for JSON scaffolding.
            max_tokens: Math.min(2000, Math.ceil(opts.reply.length / 2) + 200),
            messages: [{ role: 'user', content: buildTransformPrompt(opts.reply, target) }],
        });
        const variant = parseTransformResponse(response.choices[0]?.message?.content);
        if (!variant) {
            counter('save_reject:unparseable');
            return null;
        }
        const violation = invarianceViolation(opts.reply, variant);
        if (violation) {
            counter(`save_reject:${violation}`);
            return null;
        }
        return variant;
    } catch {
        counter('save_reject:transform_failed');
        return null;
    }
}
