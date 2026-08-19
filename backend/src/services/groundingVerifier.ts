/**
 * Grounding verifier — Phase 1, DETECTION ONLY.
 * ─────────────────────────────────────────────────────────────────────────────
 * A second, independent model call that reads a reply we ALREADY SENT and asks
 * one question: is every factual assertion in it supported by the merchant's
 * Business Info? Unsupported → the message is flagged and lands in Needs
 * Attention. The reply itself is never touched in this phase.
 *
 * WHY IT EXISTS. The reply pipeline enforces grounding for exactly one thing:
 * numbers (`flagHallucinatedPrice`, Check 1 in ai-worker's replyValidator).
 * Places, product names, availability, policies and payment terms are governed
 * by prompt rules, and prompt rules are advisory — SYSTEM_ANALYSIS gap 13.
 *
 * WHY NOT A SELF-REPORT. That was built and rejected on measurement
 * (2026-07-28): the generator stops reporting its own claims precisely when it
 * is defending a wrong one. This is a separate call with no persona, no
 * conversation to defend, and only (business info, question, reply) in context.
 *
 * WHY FIRE-AND-FORGET, AFTER THE SEND. Industry guardrails (Bedrock contextual
 * grounding, Decagon Watchtower) run INLINE and block the response — and that
 * is where this ends up in Phase 2, once precision is proven. It runs async
 * here on purpose: while the output is only a flag, there is no reason to make
 * a customer wait, and no failure here can delay or corrupt a reply. Same slot
 * and same contract as `maybeCaptureLead` — callers MUST NOT await it.
 *
 * MEASURED BEFORE IT WAS WRITTEN (scripts/grounding-audit.ts, 2026-07-28,
 * gpt-4.1-mini, 204 real replies from the four accounts that matter):
 *   - fires on 15.7% of replies; 26 of 32 firings had NO flag at all before
 *   - hand-adjudicated 22 real / 4 false / 6 borderline
 *   - recall ~81%, probed by re-scoring the passes with gpt-4.1
 *   - $0.001/reply. gpt-4.1-nano, gpt-4o-mini and gpt-5-mini were all tested
 *     and all flag an honest denial ("we have no branch in X"), which is the
 *     failure that got the previous guard rejected. gpt-4.1-mini is the floor.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { messages, comments } from '../db/schema';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { makeTrackedOpenAI, type TrackedOpenAI } from './openaiClient';
import { Logger, noopLogger } from '../types';

/** Flag written when the verifier finds an unsupported assertion. Deliberately
 *  NOT in KB_GAP_FLAGS yet: those carry `{question}` meta and drive the "Add to
 *  Business Info" CTA. Most firings ARE KB gaps (16 of the 22 real ones), so
 *  promoting it there is the obvious follow-up — but only once the meta shapes
 *  are reconciled, not as a side effect of shipping detection. */
export const GROUNDING_FLAG = 'reply_not_grounded';

/** flag_meta key used in shadow mode. Deliberately NOT a flag_reason value:
 *  nothing in the UI resolves it, so a shadow verdict is invisible everywhere a
 *  merchant looks and lives only for SQL:
 *    SELECT id, flag_meta->'reply_not_grounded_shadow' FROM messages
 *    WHERE flag_meta ? 'reply_not_grounded_shadow';
 */
export const GROUNDING_SHADOW_META_KEY = 'reply_not_grounded_shadow';

/** Intents whose replies assert nothing worth checking. Measured on 30 days of
 *  prod: 22.5% of AI replies, averaging 53-61 characters — greetings, thanks,
 *  and abuse handling. Verifying them is pure spend. */
const NON_ASSERTIVE_INTENTS = new Set(['GREETING', 'COMPLIMENT', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT']);

/** Shortest reply worth verifying. At 80 characters the gate keeps 29 of the 32
 *  firings measured in the prod sweep while cutting the verified volume to 62%
 *  — the measured knee of that curve. Below it, replies are acknowledgements. */
const MIN_REPLY_CHARS = 80;

/** A KB this short cannot ground anything; the reply is running on persona
 *  alone and every claim would flag. Those pages need Business Info, not a
 *  guard, and flagging their every reply would bury the merchants who don't. */
const MIN_KB_CHARS = 200;

/** Hard ceiling on the verifier call. It is entirely off the customer's path,
 *  so a slow verdict costs nothing but a worker slot — but an unbounded call
 *  would hold one forever. */
const VERIFY_TIMEOUT_MS = 20_000;

/** The verifier is pinned, NOT resolved per user like the reply model. A
 *  merchant's model choice governs how their replies are WRITTEN; it must not
 *  silently change how those replies are AUDITED, or the flag means something
 *  different per account and the precision number stops being one number. */
const VERIFIER_MODEL = 'gpt-4.1-mini';

const PIPELINE = 'grounding_verify';

export interface UnsupportedClaim {
    /** The span of the reply that is not supported — quoted, not paraphrased. */
    text: string;
    kind: 'price' | 'place' | 'entity' | 'availability' | 'policy' | 'other';
    /** Why Business Info does not support it. Shown to the merchant. */
    why: string;
}

interface VerifierResponse {
    verdict: 'grounded' | 'unsupported';
    unsupported_claims: UnsupportedClaim[];
}

/**
 * Verifier prompt. Every clause below traces to a measured failure — see
 * scripts/grounding-audit.ts for the labeled cases that pin each one.
 *
 * The honest-denial exemption is load-bearing: the single firing the REJECTED
 * self-report guard produced across four eval suites was on a truthful "we have
 * no branch in Misrata". A guard whose only firing is a false positive is worse
 * than no guard.
 *
 * Attribution is its own violation class because every pharmacy name in the
 * العجيلات fabrication was real — only the city was invented. A check that asks
 * "does this string appear in the KB" passes that reply.
 */
export const GROUNDING_VERIFIER_PROMPT = `You are a strict grounding auditor for a business's customer-service assistant.

You receive:
- <business_info>: the merchant's business facts — knowledge base, confirmed fields, catalogue, lists.
- <merchant_instructions>: the persona the merchant wrote for the assistant. It may be absent. Merchants put more than tone here: a name for the assistant, and policies ("no booking over social media", "send the showroom numbers, not head office"). It is an EQUALLY permitted source — a reply using the assistant name or the policy stated here is supported, not invented.
- Together, <business_info> and <merchant_instructions> are everything the merchant has told the assistant, and the ONLY permitted sources of truth.
- <conversation>: earlier turns, if any.
- The CUSTOMER is the authority on what they WANT — the quantity, size, city, or product they are asking about. They are never an authority on what the business offers or charges. So a reply may take "two packs" from the customer and price it from <business_info>; it may not take a PRICE from the customer.
- <customer_message>: the message being answered.
- <reply>: what the assistant sent.

Your single question: does every factual assertion in <reply> follow from what the merchant told the assistant?

Every rule below names <business_info>. Read each one as "<business_info> OR <merchant_instructions>" — a claim supported by either is supported.

REPORT a claim as unsupported when the reply:
- states a price, number, date, duration, or quantity that is not in <business_info>. Before reporting a TOTAL, compute it yourself: if it equals a listed price times the quantity the customer asked for, plus any listed fee, it IS supported — do not report it merely because the total is not written in <business_info>. Report a total only when no combination of listed prices produces it, or when the unit price it multiplies covers a different quantity than the reply assumed;
- names a product, service, brand, person, branch, or place that is not in <business_info>;
- ATTRIBUTES something that IS in <business_info> to a place, time, category, or attribute that <business_info> does not attach to it (e.g. listing real branches under a city the info never places them in) — the names being real does not make the attribution supported;
- confirms availability, coverage, delivery, stock, a policy, a payment method, a warranty, or that some action has been completed, when <business_info> does not state it;
- answers "yes" to an attribute the customer proposed (online / available / includes X / delivers to Y) that <business_info> does not state.

DO NOT report:
- saying the information is unavailable, that it cannot be confirmed, or directing the customer to contact the business — a denial is never a fabrication, even when it repeats a place or product the customer named;
- repeating a name, city, or product the CUSTOMER introduced, as long as the reply does not confirm it;
- asking a clarifying question;
- greetings, thanks, apologies, or offers to help that carry no specific claim;
- restating <business_info> in other words, another dialect, or another language;
- a computed total whose arithmetic checks out over prices in <business_info> — do the arithmetic yourself; a total need not appear literally (two packs at a listed 45 = 90 is supported). One exception: if <business_info> says that price already covers two pieces, a pack, or a bundle, multiplying it as a single-item price is unsupported even though the sum is right;
- offering a DIFFERENT option that IS in <business_info>, clearly presented as the alternative.

Judge assertions only. Tone, dialect, politeness, emoji, and length are never violations.
Be conservative: if a claim is plausibly covered by <business_info>, treat it as supported.

Return JSON only. "unsupported_claims" is the DEFECT LIST, not a worklist: list an
assertion there ONLY if you have decided <business_info> does not support it. If you
examined an assertion and found it supported, it does not belong in the array. When
every assertion is supported, return an empty array — that is the normal outcome.`;

/** Exported so scripts/grounding-audit.ts measures the EXACT shape production
 *  uses — a harness scoring a drifted schema measures nothing. */
export const GROUNDING_VERDICT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'unsupported_claims'],
    properties: {
        verdict: { type: 'string', enum: ['grounded', 'unsupported'] },
        unsupported_claims: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'kind', 'why'],
                properties: {
                    text: { type: 'string' },
                    kind: { type: 'string', enum: ['price', 'place', 'entity', 'availability', 'policy', 'other'] },
                    why: { type: 'string' },
                },
            },
        },
    },
} as const;

/**
 * Assemble the source text the verifier judges against. It MUST match what the
 * generator actually saw, or the verdict is meaningless — a reply grounded in a
 * store policy we forgot to include here would flag as invented.
 *
 * This mirrors `getKBText(request, { includeProductCatalog: true })` in
 * ai-worker/src/services/reply/replyContext.ts, which is the source of truth for
 * that composition. The duplication is deliberate and bounded: unifying them
 * means moving the composition into @jawab24/shared and editing the reply hot
 * path, which this detection-only phase explicitly does not touch. Fold them
 * together when the verifier moves inline in Phase 2 — and until then, a change
 * to getKBText must be mirrored here.
 */
export function buildGroundingSource(parts: {
    knowledgeBase?: string | null;
    postMessage?: string | null;
    storePolicies?: string | null;
    productCatalog?: string | null;
    /** G1a: the <business_lists> block. Omitting it would make every reply that
     *  correctly quotes an outlet, zone, or coverage area read as invented —
     *  turning the fix into a source of false flags on the very pages it serves. */
    factCollectionsBlock?: string | null;
    /** The BUSINESS_INFO block — the merchant's CONFIRMED fields (address, hours,
     *  phone, delivery, payment), rendered by `formatBusinessInfoPrompt`.
     *
     *  It reaches the model on its own path (contextEnricher → generator →
     *  promptBuilder), NOT inside `knowledgeBase`, so leaving it out here made the
     *  verifier blind to every field the merchant confirmed. Measured on prod
     *  2026-08-04: 17 of الفريق الدمشقي's 66 flags in 10 days were replies quoting
     *  his own address — he had moved it out of the KB free text into the address
     *  field the day before, and the verifier could no longer see it. The same
     *  reasoning as `factCollectionsBlock` above: a block the generator reads and
     *  the verifier does not is a false-flag factory, and it fires hardest on the
     *  pages that adopted the feature. */
    businessInfoBlock?: string | null;
    /** ⛔ The PERSONA is deliberately NOT a part here — see
     *  `buildVerifierUserMessage`, which carries it as its own section.
     *
     *  It is a grounding source (a reply obeying it is not inventing), but this
     *  function's output is ALSO what `shouldVerifyGrounding` measures against
     *  MIN_KB_CHARS, and that floor exists to skip pages "running on persona
     *  alone". Folding the persona in here would let it satisfy the very floor
     *  written to exclude it: measured 2026-08-19, 6 of 38 live pages sit under
     *  the floor on Business Info yet clear it once their persona is counted, so
     *  every claim on exactly the starved pages the floor protects would flag. */
}): string {
    return [
        parts.knowledgeBase,
        parts.postMessage,
        parts.storePolicies,
        parts.productCatalog,
        parts.factCollectionsBlock,
        parts.businessInfoBlock,
    ]
        .filter((p): p is string => !!p && p.trim().length > 0)
        .join('\n\n');
}

/**
 * The verifier's user message. Pure and exported for the same reason
 * `shouldVerifyGrounding` is: this is where a source can go missing, and the
 * only cheap way to pin that it did not.
 *
 * `persona` is `settings.brandVoiceNotes(Multi)` (or the per-page override)
 * resolved through `resolveBrandVoiceNotes`. It reaches the model on its own
 * path (contextEnricher → generator → promptBuilder:443), never inside
 * `knowledgeBase`, and until 2026-08-19 the verifier could not see it at all —
 * the third instance of one class, after `postMessage` (07-30) and
 * `businessInfoBlock` (08-04). Prod symptom: ام. اي. اس writes «الاسم: معك رنيم
 * من شركة ام اي اس», the reply obeyed, and the verifier reported the merchant's
 * own assistant name as an invented employee.
 *
 * It gets its OWN tag rather than being folded into <business_info> for two
 * reasons: the floor above, and honesty — this text is bare imperative prose
 * («الاسم: …»), not the factual, pre-rendered blocks the other tag holds.
 *
 * The WHOLE block goes in, not just the persona's name. Merchants keep policy
 * in this field: «لا يوجد لدينا تثبيت حجز عن طريق وسائل التواصل الاجتماعي»
 * (منتجع شاهين), «رقم الادارة لا يرسل إلا في حالة طلب» (ام. اي. اس). Identity
 * alone would leave the same false-flag class alive for every policy answer.
 * Bounded at 800 chars (MAX_BRAND_VOICE_LENGTH) on save.
 *
 * Ordering is load-bearing for cost: <business_info> stays FIRST and the
 * page-stable persona sits directly behind it, so OpenAI's prompt cache still
 * hits on the largest span. Per-reply text stays below both.
 */
export function buildVerifierUserMessage(parts: {
    kb: string;
    persona?: string | null;
    conversation?: string | null;
    question: string;
    reply: string;
}): string {
    return [
        `<business_info>\n${parts.kb}\n</business_info>`,
        parts.persona && parts.persona.trim().length > 0
            ? `<merchant_instructions>\n${parts.persona}\n</merchant_instructions>`
            : '',
        parts.conversation ? `<conversation>\n${parts.conversation}\n</conversation>` : '',
        `<customer_message>\n${parts.question}\n</customer_message>`,
        `<reply>\n${parts.reply}\n</reply>`,
    ].filter(Boolean).join('\n\n');
}

export interface GroundingGateInput {
    /** Page the reply belongs to — checked against the pilot allowlist. */
    pageId: string;
    replyMethod: string | null | undefined;
    intent: string | null | undefined;
    reply: string | null | undefined;
    kb: string | null | undefined;
    /** True when the reply was served from the semantic/exact cache. A cached
     *  reply was verified when it was first generated; re-verifying it pays
     *  again for a verdict we already have. */
    fromCache?: boolean;
}

/**
 * Whether this reply is worth verifying. Pure and exported so the gate can be
 * unit-tested on its own — the same posture as every check in replyValidator.
 * Each clause is a measured cut, not a guess; see the constants above.
 */
export function shouldVerifyGrounding(input: GroundingGateInput): boolean {
    if (!config.groundingVerify?.enabled) return false;
    // An allowlist restricts the pilot to named pages; empty means fleet-wide.
    const allowed = config.groundingVerify.pageIds;
    if (allowed && allowed.length > 0 && !allowed.includes(input.pageId)) return false;
    // Only AI-authored text can hallucinate. Canned templates (away, greeting,
    // fallbacks) and human replies are merchant-authored by definition.
    if (input.replyMethod !== 'ai') return false;
    if (input.fromCache) return false;
    if (NON_ASSERTIVE_INTENTS.has(input.intent || '')) return false;
    if (!input.reply || input.reply.length < MIN_REPLY_CHARS) return false;
    if (!input.kb || input.kb.length < MIN_KB_CHARS) return false;
    return true;
}

export interface MaybeVerifyGroundingParams {
    userId: string;
    pageId: string;
    /** Row to flag. `messages.id` or `comments.id`, matching sourceType. */
    sourceId: string;
    sourceType: 'message' | 'comment';
    /** Business Info exactly as the reply pipeline assembled it. */
    kb: string;
    /** The merchant's persona, exactly as the generator received it. A separate
     *  field, not folded into `kb`, so it can ground a claim without counting
     *  toward MIN_KB_CHARS — see `buildVerifierUserMessage`. */
    persona?: string | null;
    question: string;
    reply: string;
    intent: string | null | undefined;
    replyMethod: string | null | undefined;
    fromCache?: boolean;
    /** Prior turns, oldest first. Optional — a claim can be grounded in an
     *  earlier turn, and omitting them costs precision. */
    history?: { q: string | null; a: string | null }[];
}

class GroundingVerifierService {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /** Tracked client per call: it owns the lifecycle counters, the
     *  ai_usage_log row, and — because we hand it a signal — the
     *  AiTimeoutError-vs-OpenAIApiError classification that §13c requires be
     *  read from the AbortSignal rather than the error. The context is
     *  per-(user, page), so the client cannot be memoised on the service. */
    private client(userId: string, pageId: string): TrackedOpenAI {
        if (!config.openai?.apiKey) {
            throw new Error('OPENAI_API_KEY not configured — grounding verification unavailable');
        }
        return makeTrackedOpenAI(config.openai.apiKey, { pipeline: PIPELINE, userId, pageId });
    }

    /**
     * Entry point, called from messageProcessor and commentProcessor after the
     * reply has been stored and sent. Fire-and-forget: callers MUST NOT await.
     * Never throws — a verifier failure must be invisible to the customer and
     * to the pipeline, so it fails OPEN (no flag) and is reported to Sentry.
     */
    async maybeVerifyGrounding(params: MaybeVerifyGroundingParams): Promise<void> {
        if (!shouldVerifyGrounding(params)) return;

        try {
            const verdict = await this.verify(params);
            if (verdict.verdict !== 'unsupported' || verdict.unsupported_claims.length === 0) return;
            await this.flagSource(params, verdict.unsupported_claims);
            this.logger.info('grounding verifier flagged a reply', {
                sourceType: params.sourceType,
                sourceId: params.sourceId,
                pageId: params.pageId,
                claims: verdict.unsupported_claims.length,
                kinds: verdict.unsupported_claims.map(c => c.kind),
            });
        } catch (error) {
            captureError(error, 'Grounding verification failed', {
                extra: {
                    pageId: params.pageId,
                    sourceType: params.sourceType,
                    sourceId: params.sourceId,
                },
            });
        }
    }

    private async verify(params: MaybeVerifyGroundingParams): Promise<VerifierResponse> {
        const conversation = (params.history || [])
            .filter(t => t.q || t.a)
            .map(t => [t.q && `customer: ${t.q}`, t.a && `assistant: ${t.a}`].filter(Boolean).join('\n'))
            .join('\n');

        // business_info goes FIRST and byte-identical for every reply on a page,
        // so OpenAI's prompt cache hits on the largest block in the request —
        // 57% of input tokens were cached even in the scattered offline sweep.
        // Do not interleave per-reply text above it.
        const user = buildVerifierUserMessage({
            kb: params.kb,
            persona: params.persona,
            conversation,
            question: params.question,
            reply: params.reply,
        });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

        let response;
        try {
            response = await this.client(params.userId, params.pageId).chat.completions.create({
                model: VERIFIER_MODEL,
                temperature: 0,
                messages: [
                    { role: 'system', content: GROUNDING_VERIFIER_PROMPT },
                    { role: 'user', content: user },
                ],
                response_format: {
                    type: 'json_schema',
                    json_schema: { name: 'grounding_verdict', strict: true, schema: GROUNDING_VERDICT_SCHEMA },
                },
            }, { signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error('Empty response from grounding verifier');
        const parsed = JSON.parse(content) as VerifierResponse;

        // The claims array is authoritative: an "unsupported" verdict carrying no
        // claim is a non-answer, and a merchant cannot act on a flag with nothing
        // in it. Deriving the verdict here keeps counting consistent everywhere.
        const claims = Array.isArray(parsed.unsupported_claims) ? parsed.unsupported_claims : [];
        return { verdict: claims.length > 0 ? 'unsupported' : 'grounded', unsupported_claims: claims };
    }

    /**
     * Append the flag and surface the row for review. Read-modify-write on
     * flag_reason is safe here because this runs once per source row, after the
     * reply pipeline is done with it — nothing else writes these columns
     * afterwards. It appends rather than replaces so an existing
     * price_not_in_kb / info_not_in_kb is never clobbered.
     */
    private async flagSource(params: MaybeVerifyGroundingParams, claims: UnsupportedClaim[]): Promise<void> {
        const table = params.sourceType === 'message' ? messages : comments;
        const [row] = await db
            .select({ flagReason: table.flagReason, flagMeta: table.flagMeta })
            .from(table)
            .where(eq(table.id, params.sourceId))
            .limit(1);
        if (!row) return;

        const meta = (row.flagMeta && typeof row.flagMeta === 'object' ? row.flagMeta : {}) as Record<string, unknown>;

        // Shadow mode: record the verdict where only SQL can see it. flag_reason
        // and needs_attention stay untouched — a merchant's dashboard must not
        // change in any way while the pilot is dark.
        if (config.groundingVerify.mode === 'shadow') {
            if (meta[GROUNDING_SHADOW_META_KEY]) return;
            await db.update(table)
                .set({ flagMeta: { ...meta, [GROUNDING_SHADOW_META_KEY]: { claims } } })
                .where(eq(table.id, params.sourceId));
            return;
        }

        const existing = (row.flagReason || '').split(',').map(f => f.trim()).filter(Boolean);
        if (existing.includes(GROUNDING_FLAG)) return;

        await db.update(table)
            .set({
                flagReason: [...existing, GROUNDING_FLAG].join(','),
                needsAttention: true,
                flagMeta: { ...meta, [GROUNDING_FLAG]: { claims } },
            })
            .where(eq(table.id, params.sourceId));
    }
}

export const groundingVerifierService = new GroundingVerifierService();
