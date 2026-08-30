/**
 * Content CTA classifier — the model half of D-111.
 *
 * Answers one narrow question about a post's TEXT, once, and stores the answer:
 * does the caption explicitly invite readers to comment with a symbol or token
 * to receive something? Output is a structured verdict (`dot` / `digits` / `word`
 * / `heart` / `any` / `none` / `uncertain`), never customer-facing text.
 *
 * WHY A MODEL AND NOT A PHRASE LIST. The invitation is written in Syrian,
 * Levantine, Gulf and Egyptian dialect, with typos («بنطقة»), hashtags
 * («#بنقطة»), no verb at all («نقطة لباقي التفاصيل»), transliteration, and
 * creative marketing copy. Measured on 2026-08-29 against 118 real posts of the
 * page the feature was built for: 90/90 captions that literally ask for a dot
 * came back `dot` (recall 100%), 5 word-CTAs correct («تم», «اسم الدورة»), 22
 * `none` all genuinely no-CTA, zero `uncertain`; and 18/18 `none` at confidence
 * 1.0 on a resort whose event videos draw dot waves with no invitation. A
 * maintained regex would have to chase every one of those shapes by hand.
 *
 * WHY LAZY. Classification runs only when a post receives its FIRST
 * content-free comment and no Post Reply rule handled it. Text comments never
 * touch this module (the gate passes them before any lookup); a post that never
 * draws a symbol is never classified. One call per post, synchronous on that
 * first comment only (~1 s once), then a primary-key row read. Rule 17: nothing
 * else is added to the per-comment path. Concurrent first comments (a dot wave
 * across the reply worker's parallel jobs) share one in-flight call.
 *
 * WHY PINNED. Like the grounding verifier, the model is fixed rather than
 * resolved per merchant: a merchant's model choice governs how replies are
 * WRITTEN, not how their posts are READ, or the same caption would classify
 * differently per account and the measured recall would stop being one number.
 *
 * WHAT IS PERSISTED. Only a verdict the model actually authored. A transport
 * error, a timeout, a truncated or unparseable response, or an out-of-contract
 * enum is NOT written — the gate treats the comment as uninvited this once and
 * the next symbol comment retries. Persisting a parse failure as `uncertain`
 * would silence a real campaign for the life of the caption with no retry path.
 *
 * Cost is metered in ai_usage_log under `post_cta_classification` (~670 tokens,
 * ~$0.0003) and never touches the merchant's reply quota.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { contentCtaClassifications } from '../db/schema';
import { config } from '../config';
import { sha256Hex } from '../utils/hash';
import { withAbortTimeout } from '../lib/abortTimeout';
import { captureError } from '../utils/sentryHelpers';
import type { TrackedOpenAI } from './openaiClient';
import { isCtaSymbol, type ContentCtaClassification, type CtaSymbol } from './reply/commentCta';
import { Logger, noopLogger } from '../types';

const CLASSIFIER_MODEL = 'gpt-4.1-mini';
const PIPELINE = 'post_cta_classification' as const;
/** Off the customer's path except for one post's first symbol comment — keep it tight. */
const CLASSIFY_TIMEOUT_MS = 15_000;
/** Structured output is ~40 tokens; the cap only guards a runaway `evidence` string. */
const MAX_OUTPUT_TOKENS = 200;
/** Longest caption worth reading — a CTA sits in the first screen of a post. */
const MAX_CAPTION_CHARS = 2500;

/**
 * The classification prompt. Every clause traces to a caption shape seen in the
 * 2026-08-29 measurement; the labeled captions are the eval fixtures in
 * scripts/playground-eval.ts category 34. The `any` clause lists the "comment
 * to receive X, no symbol named" shapes explicitly because the first run read
 * «علق لتصلك الأسعار» as `none` (eval #257/#304).
 */
export const CTA_CLASSIFIER_PROMPT = `You classify a social-media post caption written by a merchant (usually Arabic, any dialect, sometimes Latin-script or mixed).
Question: does the caption explicitly invite readers to COMMENT with a specific symbol or token in order to receive something (details, price, catalogue, link, address, times)?

Return JSON only:
{
  "cta_symbol": "none" | "dot" | "digits" | "word" | "heart" | "any" | "uncertain",
  "cta_word": string | null,
  "confidence": number,
  "evidence": string | null
}

Rules:
- "dot": the caption asks to comment with a dot/point ("علّق بنقطة", "علقي بنقطة", "نقطة لمعرفة التفاصيل", "comment a dot", spelling variants like "بنطقة", hashtagged "#بنقطة"). A bare "نقطة لباقي التفاصيل" without a verb still counts as dot.
- "digits": asks to comment a number ("اكتب 1", "علق برقم 0", "comment 000").
- "word": asks to comment a specific word ("اكتب تم", "علق ب (تم)", "علق باسم الدورة", "comment DONE") — put the requested word or phrase in cta_word.
- "heart": asks to comment a heart/specific emoji ("حط ❤️", "علق بقلب").
- "any": asks readers to COMMENT in order to receive something but names NO specific symbol or word — "علّق وبنبعتلك التفاصيل", "علق لتصلك الأسعار", "علق ليصلك الكتالوج", "اكتب بالتعليقات ونرسلك", "comment below for the price", "علق بأي إيموجي". A request for a like/reaction alongside the comment ("علق بلايك", "حط لايك وعلق") is still "any" — the comment is what they must leave.
- "none": no such invitation. The caption may mention "التفاصيل", "للاستفسار", a phone number, "راسلنا", "تواصل معنا", "سجل الآن", decorative dots "....", or ask "شو رأيكم؟" — none of these ask the reader to COMMENT to receive something.
- "uncertain": wording hints at a comment CTA but the invitation or the requested symbol is ambiguous.
- Decorative emoji in the caption are not a CTA. Judge only what the merchant asks readers to DO in the comments.
- confidence reflects how explicit the invitation is.`;

const RESPONSE_SCHEMA = {
    name: 'cta_classification',
    strict: true,
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            cta_symbol: { type: 'string', enum: ['none', 'dot', 'digits', 'word', 'heart', 'any', 'uncertain'] },
            cta_word: { type: ['string', 'null'] },
            confidence: { type: 'number' },
            evidence: { type: ['string', 'null'] },
        },
        required: ['cta_symbol', 'cta_word', 'confidence', 'evidence'],
    },
} as const;

export interface CtaVerdict extends ContentCtaClassification {
    evidence: string | null;
    model: string;
}

export function captionHash(caption: string): string {
    return sha256Hex(caption.trim());
}

/**
 * Parse the model's JSON into a verdict, or `null` when the response is not a
 * verdict at all — empty, unparseable, an unknown symbol, a `word` verdict with
 * no word, or a non-numeric confidence. Exported so the contract is pinned by a
 * unit test. `null` is the caller's signal NOT to persist: the model said
 * nothing usable, which is different from the model saying `uncertain`.
 */
export function parseCtaVerdict(content: string | null | undefined, model: string): CtaVerdict | null {
    if (!content) return null;
    let parsed: { cta_symbol?: unknown; cta_word?: unknown; confidence?: unknown; evidence?: unknown };
    try {
        parsed = JSON.parse(content);
    } catch {
        return null;
    }
    if (!isCtaSymbol(parsed.cta_symbol)) return null;
    if (typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence)) return null;
    const symbol: CtaSymbol = parsed.cta_symbol;
    const word = symbol === 'word' && typeof parsed.cta_word === 'string' && parsed.cta_word.trim().length > 0
        ? parsed.cta_word.trim()
        : null;
    if (symbol === 'word' && !word) return null;
    return {
        symbol,
        word,
        confidence: Math.min(1, Math.max(0, parsed.confidence)),
        evidence: typeof parsed.evidence === 'string' ? parsed.evidence.slice(0, 500) : null,
        model,
    };
}

export interface ClassifyContentParams {
    /** `posts.id` / `instagram_media.id`. */
    contentId: string;
    platform: 'facebook' | 'instagram';
    pageId: string;
    userId: string;
    caption: string;
}

type ClientFactory = (ctx: { userId: string; pageId: string }) => Promise<TrackedOpenAI>;

/** The persisted row, as the service reads and writes it. */
export interface StoredCtaRow {
    contentId: string;
    platform: 'facebook' | 'instagram';
    pageId: string;
    captionHash: string;
    ctaSymbol: string;
    ctaWord: string | null;
    confidence: number;
    evidence: string | null;
    model: string;
    classifiedAt: Date;
}

/**
 * Storage seam — the table behind the service. The default is the Drizzle table;
 * tests inject an in-memory map so single-flight and "a failure is never
 * persisted" are pinned against the service's own logic, not against a hand-rolled
 * query-builder mock that decides the verdict.
 */
export interface CtaStore {
    get(contentId: string): Promise<StoredCtaRow | null>;
    upsert(row: StoredCtaRow): Promise<void>;
    bump(contentId: string, column: 'uninvitedSkips' | 'shadowSkips'): Promise<void>;
}

const drizzleStore: CtaStore = {
    async get(contentId) {
        const [row] = await db
            .select()
            .from(contentCtaClassifications)
            .where(eq(contentCtaClassifications.contentId, contentId))
            .limit(1);
        return row ? { ...row, platform: row.platform as 'facebook' | 'instagram' } : null;
    },
    async upsert(row) {
        await db
            .insert(contentCtaClassifications)
            .values(row)
            .onConflictDoUpdate({ target: contentCtaClassifications.contentId, set: row });
    },
    async bump(contentId, column) {
        const col = column === 'uninvitedSkips' ? contentCtaClassifications.uninvitedSkips : contentCtaClassifications.shadowSkips;
        await db.update(contentCtaClassifications)
            .set({ [column]: sql`${col} + 1` })
            .where(eq(contentCtaClassifications.contentId, contentId));
    },
};

class ContentCtaClassifierService {
    private logger: Logger = noopLogger;
    private store: CtaStore = drizzleStore;
    /** Single-flight per content row: concurrent first comments on one post (a dot
     *  wave across parallel reply-worker jobs) share one classification instead of
     *  each paying the call and racing the upsert. In-process, keyed by content id,
     *  deleted on settle — same shape as pageTokenRecovery's `inFlight`. */
    private inFlight = new Map<string, Promise<ContentCtaClassification | null>>();
    /** Test seam: replaces the tracked client factory (never the prompt or the parser).
     *  The default resolves `openaiClient` lazily: that module's `aiUsageLog` import
     *  constructs the live Redis client at load time, and this service is imported by
     *  the generator — a static import here would drag Redis into every unit test that
     *  loads the generator with a partial config mock. */
    private clientFactory: ClientFactory = async (ctx) => {
        const { makeTrackedOpenAI } = await import('./openaiClient');
        return makeTrackedOpenAI(config.openai.apiKey, { userId: ctx.userId, pageId: ctx.pageId, pipeline: PIPELINE });
    };

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /** Test-only. */
    setClientFactory(factory: ClientFactory): void {
        this.clientFactory = factory;
    }

    /** Test-only. */
    setStore(store: CtaStore): void {
        this.store = store;
    }

    /**
     * The verdict for a content row — from the table when its caption hash still
     * matches, else one model call, persisted. Returns null (→ the gate reads
     * `uncertain`) when the classifier is disabled, the caption is empty, or the
     * call produced no verdict; a null is never persisted, so the next symbol
     * comment retries.
     */
    async getOrClassify(params: ClassifyContentParams): Promise<ContentCtaClassification | null> {
        const caption = params.caption.trim();
        if (!caption) return null;
        // The kill switch means "no classifier at all": no read, no call — every post
        // reads as `uncertain` while it is off, exactly as config/index.ts documents.
        if (!config.commentCta?.classifierEnabled) return null;

        const existing = this.inFlight.get(params.contentId);
        if (existing) return existing;
        const run = this.classifyAndStore(params, caption).finally(() => {
            this.inFlight.delete(params.contentId);
        });
        this.inFlight.set(params.contentId, run);
        return run;
    }

    private async classifyAndStore(params: ClassifyContentParams, caption: string): Promise<ContentCtaClassification | null> {
        const hash = captionHash(caption);
        const existing = await this.store.get(params.contentId);
        if (existing && existing.captionHash === hash && isCtaSymbol(existing.ctaSymbol)) {
            return { symbol: existing.ctaSymbol, word: existing.ctaWord, confidence: existing.confidence };
        }

        const verdict = await this.classifyCaption(caption, { userId: params.userId, pageId: params.pageId, contentId: params.contentId });
        if (!verdict) return null;

        const row: StoredCtaRow = {
            contentId: params.contentId,
            platform: params.platform,
            pageId: params.pageId,
            captionHash: hash,
            ctaSymbol: verdict.symbol,
            ctaWord: verdict.word,
            confidence: verdict.confidence,
            evidence: verdict.evidence,
            model: verdict.model,
            classifiedAt: new Date(),
        };
        try {
            await this.store.upsert(row);
        } catch (err) {
            // The verdict is still good for THIS comment; only the memo failed.
            captureError(err, 'Content CTA classification could not be persisted', {
                level: 'warning',
                fingerprint: ['content-cta-persist-failed'],
                extra: { contentId: params.contentId },
            });
        }

        this.logger.info('[ContentCta] Classified post caption', {
            contentId: params.contentId, pageId: params.pageId, symbol: verdict.symbol,
            word: verdict.word, confidence: verdict.confidence,
        });
        return { symbol: verdict.symbol, word: verdict.word, confidence: verdict.confidence };
    }

    /**
     * Playground / eval path: no content row, nothing persisted — one call per
     * request. Same prompt, same parser, same model, so the eval exercises the
     * production classifier, not a stand-in (Rule 19). The eval's ~20 symbol cases
     * cost ~$0.006 a run; a memo here is not worth a second cache to keep correct.
     */
    async classifyForPlayground(caption: string, ctx: { userId: string; pageId: string }): Promise<ContentCtaClassification | null> {
        const trimmed = caption.trim();
        if (!trimmed || !config.commentCta?.classifierEnabled) return null;
        const verdict = await this.classifyCaption(trimmed, ctx);
        return verdict ? { symbol: verdict.symbol, word: verdict.word, confidence: verdict.confidence } : null;
    }

    /**
     * Per-post tally of gate outcomes — the input the Post Reply nudge reads and the
     * shadow week's per-post audit, without scraping logs. A no-op when the post has
     * no classification row (the classifier was off or never produced a verdict): a
     * count with no verdict beside it would be unreadable anyway. Fire-and-forget.
     */
    recordGateOutcome(contentId: string, kind: 'skip' | 'shadow_skip'): void {
        this.store.bump(contentId, kind === 'skip' ? 'uninvitedSkips' : 'shadowSkips')
            .catch((err: unknown) => {
                captureError(err, 'Content CTA gate outcome could not be recorded', {
                    level: 'warning', fingerprint: ['content-cta-outcome-failed'], extra: { contentId, kind },
                });
            });
    }

    /** One model call → a verdict, or null on any failure (already reported). */
    private async classifyCaption(caption: string, ctx: { userId: string; pageId: string; contentId?: string }): Promise<CtaVerdict | null> {
        if (!config.openai.apiKey) {
            // No key = no classifier (unit-test processes, a misconfigured box). Quiet:
            // the gate reads `uncertain`, and the health of the key is someone else's alarm.
            return null;
        }
        try {
            const client = await this.clientFactory(ctx);
            const response = await withAbortTimeout(CLASSIFY_TIMEOUT_MS, signal => client.chat.completions.create({
                model: CLASSIFIER_MODEL,
                temperature: 0,
                max_tokens: MAX_OUTPUT_TOKENS,
                response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
                messages: [
                    { role: 'system', content: CTA_CLASSIFIER_PROMPT },
                    { role: 'user', content: `CAPTION:\n${caption.slice(0, MAX_CAPTION_CHARS)}` },
                ],
            }, { signal }));
            const choice = response.choices[0];
            // A cut-off object is not a verdict; name the cause so the cap stays measurable.
            if (choice?.finish_reason === 'length') {
                throw new Error(`CTA classification JSON truncated at max_tokens (cap=${MAX_OUTPUT_TOKENS})`);
            }
            const verdict = parseCtaVerdict(choice?.message?.content, response.model || CLASSIFIER_MODEL);
            if (!verdict) throw new Error('CTA classifier returned no usable verdict');
            return verdict;
        } catch (err) {
            captureError(err, 'Content CTA classification failed', {
                level: 'warning',
                fingerprint: ['content-cta-classify-failed'],
                tags: { pageId: ctx.pageId },
                extra: { contentId: ctx.contentId ?? null },
            });
            return null;
        }
    }
}

export const contentCtaClassifier = new ContentCtaClassifierService();
