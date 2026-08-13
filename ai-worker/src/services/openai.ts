import OpenAI from 'openai';
import * as Sentry from '@sentry/node';
import { config } from '../config';
import { PROMPT_VERSION, classifyTimeoutAbort, isTimeoutAbort } from '@jawab24/shared';
import {
    AiClientNotConfiguredError,
    AiTimeoutError,
    AiRefusalError,
    AiEmptyReplyError,
    AiQuotaExhaustedError,
    isInsufficientQuotaError,
    AI_TYPED_ERROR_NAMES,
} from '../lib/errors';
import { recordAiFailedBeforeLog, withAiMetrics } from '../lib/aiMetrics';
import { detectLanguage } from './language';
import {
    KB_MAX_CHARS,
    MAX_INPUT_TOKENS,
    buildSystemPrompt as buildSystemPromptText,
    buildUserPrompt,
} from './reply/promptBuilder';
import { validateReply as runValidateReply, isHeldEmptyReply } from './reply/replyValidator';
import type { GenerateRequest, GenerateResponse, ParsedReply, ValidatedReply, TokenInfo } from './reply/types';

// Re-export the request/response contract so existing importers keep using
// `from './openai'` (routes.ts, worker.ts, ecommerceToolHandler.ts, providers/).
export type {
    ConversationMessage,
    RetrievedChunkContext,
    GenerateRequest,
    GenerateResponse,
} from './reply/types';

/** Conservative token estimate: ~3.5 chars per token (safe across Latin + Arabic) */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
}

/**
 * Appended to the conversation when the first generation was cut off at
 * max_tokens (finish_reason 'length') before retrying once. Business-agnostic
 * on purpose — no merchant specifics and no absolute length targets; the base
 * prompt already fixes language/persona, this only forces brevity.
 */
const TRUNCATION_RETRY_MESSAGE: OpenAI.ChatCompletionMessageParam = {
    role: 'system',
    content: 'Your previous attempt was cut off because it exceeded the maximum response length. '
        + 'Write the reply again concisely: answer the customer\'s message directly in a few short '
        + 'sentences with only the most essential facts. Keep the same language, persona, and tone.',
};

/** Sum token counts across the truncated and retried call; undefined only when both are. */
function addTokens(a?: number, b?: number): number | undefined {
    return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

/**
 * Sum the usage of attempts we threw away. Both retries below discard a call that
 * OpenAI already billed, so `ai_usage_log` and the admin cost panel must still see
 * that spend — otherwise a retry looks free and per-merchant cost under-reports.
 */
function mergeUsage(
    a?: OpenAI.CompletionUsage,
    b?: OpenAI.CompletionUsage,
): OpenAI.CompletionUsage | undefined {
    if (!a) return b;
    if (!b) return a;
    return {
        ...a,
        total_tokens: (a.total_tokens ?? 0) + (b.total_tokens ?? 0),
        prompt_tokens: (a.prompt_tokens ?? 0) + (b.prompt_tokens ?? 0),
        completion_tokens: (a.completion_tokens ?? 0) + (b.completion_tokens ?? 0),
        prompt_tokens_details: {
            ...(a.prompt_tokens_details ?? {}),
            cached_tokens: (a.prompt_tokens_details?.cached_tokens ?? 0)
                + (b.prompt_tokens_details?.cached_tokens ?? 0),
        },
    };
}

export class OpenAIService {
    private client: OpenAI | null = null;

    constructor() {
        if (config.openai.apiKey) {
            this.client = new OpenAI({
                apiKey: config.openai.apiKey,
                maxRetries: 3,
            });
        }
    }

    /**
     * Check if OpenAI is configured
     */
    isConfigured(): boolean {
        return this.client !== null && config.openai.apiKey.length > 0;
    }

    /**
     * Generate a reply for a comment or message
     */
    async generateReply(request: GenerateRequest): Promise<GenerateResponse> {
        if (!this.client) {
            // Root cause is missing OPENAI_API_KEY at startup — should also fail
            // the healthcheck. Throw a typed error so backend's reply pipeline
            // catches it via isTransientAiError and the row reaches
            // needs_attention via flagStuckJobOnFinalFailure.
            throw new AiClientNotConfiguredError();
        }

        try {
            const systemPrompt = this.buildSystemPrompt(request);
            const { messages, tokenInfo } = this.buildMessages(request, systemPrompt);

            // Log token usage for observability
            console.log(JSON.stringify({ event: 'ai_call_token_usage', ...tokenInfo }));

            let completion = await this.createCompletion(messages, request.context?.pipeline);

            // Truncation retry — finish_reason 'length' means OpenAI stopped
            // generating at max_tokens, so the strict-schema JSON envelope is cut
            // mid-string and can never parse. Merchant Business Info can steer the
            // model into replies bigger than the completion cap (July 2026: a long
            // campaign-pitch KB turned price questions into truncated replies →
            // customers got silence). Retry ONCE with an explicit brevity
            // instruction appended; the resent prefix is byte-identical, so
            // OpenAI's prompt cache absorbs most of the input cost. If the retry
            // is still truncated, fall through — the broken-JSON guard and
            // empty-reply throw below flag the message exactly as before.
            // Applies regardless of whether the cut content happens to parse:
            // a parseable-but-cut reply is still a cut reply.
            //
            // Usage of every discarded attempt (truncation retry AND refusal retry).
            // `wasTruncated` is tracked separately because only truncation earns the
            // `reply_shortened` badge — a refusal retry shortens nothing.
            let discardedUsage: OpenAI.CompletionUsage | undefined;
            let wasTruncated = false;
            // The message list that produced the CURRENT completion. The refusal retry below
            // must resend THIS, not the original `messages`: when a truncation retry is itself
            // refused, resending the original drops the brevity instruction that was added
            // because the reply overflowed — so the third call can truncate again and the
            // customer ends up with nothing after three billed attempts.
            let activeMessages: OpenAI.ChatCompletionMessageParam[] = messages;
            let finishReason = completion.choices[0]?.finish_reason;
            if (finishReason === 'length') {
                console.log(JSON.stringify({
                    event: 'truncated_reply_retry',
                    pipeline: request.context?.pipeline,
                    model: config.openai.model,
                    tokensOut: completion.usage?.completion_tokens,
                }));
                discardedUsage = mergeUsage(discardedUsage, completion.usage);
                wasTruncated = true;
                activeMessages = [...messages, TRUNCATION_RETRY_MESSAGE];
                completion = await this.createCompletion(activeMessages, request.context?.pipeline);
                finishReason = completion.choices[0]?.finish_reason;
            }
            // recordAiReturn emitted inside withAiMetrics on success. The
            // post-receive guards below (refusal, empty reply, hedging) run
            // *after* — they fire recordAiFailedBeforeLog explicitly because
            // the OpenAI call was billed but the content is unusable.

            // Structured-output refusal — RETRY ONCE before believing it.
            //
            // The old code threw here immediately, on the premise written in this very
            // comment: "Non-transient: same input → same refusal." That premise was
            // measured FALSE on 2026-08-13:
            //   - all 512 stored refusal texts from 90 days of production were read
            //     one by one. NOT ONE was a refusal — every one was a normal, correct
            //     reply, median 82 chars, in the merchant's own voice and dialect;
            //   - 20 of them were replayed against their real page data, 3 samples each,
            //     on a page whose KB and settings were provably unchanged since the
            //     refusal fired. 60 replays, 60 normal replies, 0 refusals.
            //
            // The mechanism, visible in 4 of the 512: the reply text carries a trailing
            // second `{"reply":…}` envelope, an `</ai_reply>` tag, or a stray
            // `</assistant` token. The model emits the answer and then keeps going. That
            // breaks the `strict: true` schema contract, and the structured-output layer
            // surfaces the text under `refusal` instead of `content`. So the ENVELOPE is
            // malformed — the content never was refused. Same root defect as the doubled
            // JSON documented on `createCompletion`'s penalty settings (eval #46,
            // 2026-05-20); it is stochastic, which is exactly why a retry clears it.
            //
            // Cost of throwing instead: ~170 discarded replies a month, ~33 customers
            // left with total silence.
            //
            // The guard is not weakened — it is finally accurate. A GENUINE policy
            // refusal is deterministic by nature, so it refuses on the retry too and
            // still throws, flags and notifies exactly as before. After this, reaching
            // AiRefusalError means the model really did decline.
            //
            // ⛔ The refusal text itself is never used as a reply: only the retry's
            // `content` is. A real refusal can therefore never reach a customer.
            let refusal = completion.choices[0]?.message?.refusal;
            if (refusal) {
                console.log(JSON.stringify({
                    event: 'structured_refusal_retry',
                    pipeline: request.context?.pipeline,
                    model: config.openai.model,
                    refusalChars: refusal.length,
                }));
                discardedUsage = mergeUsage(discardedUsage, completion.usage);
                completion = await this.createCompletion(activeMessages, request.context?.pipeline);
                finishReason = completion.choices[0]?.finish_reason;
                refusal = completion.choices[0]?.message?.refusal;
            }
            if (refusal) {
                Sentry.addBreadcrumb({
                    category: 'openai',
                    level: 'info',
                    message: 'openai_structured_refusal',
                    data: { refusal, model: config.openai.model },
                });
                recordAiFailedBeforeLog(request.context?.pipeline, config.openai.model, 'AiRefusalError');
                throw new AiRefusalError(refusal);
            }

            const content = completion.choices[0]?.message?.content?.trim() || '';
            const detectedLanguage = detectLanguage(request.comment);

            // Parse structured JSON response; fall back to plain text if parsing fails
            let parsed: ParsedReply;
            try {
                parsed = JSON.parse(content);
            } catch {
                // JSON parse failed. Two very different cases:
                //   1. A broken/partial JSON blob (the model tried to emit the schema but it
                //      didn't parse — doubled JSON, or a reply whose text broke the string). This
                //      must NEVER be sent raw: it looks like `{"reply":"..."}` and, when a
                //      merchant's Business Info contains prompt-like text, leaks internal config
                //      to the customer (observed in prod). Treat as a failed generation (reply:''
                //      → the empty-reply guard below throws → backend flags needs_attention).
                //   2. A genuine plain-text reply (model answered without wrapping in JSON) — safe
                //      to use as-is, preserving the long-standing fallback.
                const looksLikeBrokenJson = content.trimStart().startsWith('{') || content.includes('"reply"');
                if (looksLikeBrokenJson) {
                    console.log(JSON.stringify({
                        event: 'invalid_json_reply',
                        pipeline: request.context?.pipeline,
                        finishReason,
                        raw: content.slice(0, 300),
                    }));
                }
                parsed = {
                    reply: looksLikeBrokenJson ? '' : content,
                    intent: 'UNKNOWN',
                    confidence: 'low',
                    flags: ['invalid_json'],
                };
            }

            // Post-reply validation: catch issues the prompt alone can't prevent
            const validated = this.validateReply(parsed, request);

            // Empty reply has THREE distinct meanings, and only one is a failure.
            // This guard is the single arbiter between them:
            //
            //   1. INTENTIONAL — OFFENSIVE / SPAM_OR_IRRELEVANT: the prompt explicitly
            //      instructs GPT to return reply:"" for these intents (see L99-100
            //      and the few-shot example at L187). Downstream `shouldSkipReply`
            //      in generator.ts handles them silently. Returning empty reply here
            //      is the contract — not an error.
            //
            //   2. HELD — Check 6 stripped the ENTIRE reply (all reveal talk) and the
            //      validator raised `self_identification_exhausted`. Also the contract:
            //      the empty reply + that flag ARE the hold signal, and the backend
            //      flags the row for merchant review (held_self_identification).
            //      Throwing here would swallow the flag before it crosses the wire and
            //      book the event as a generic ai_empty_reply — which is exactly what
            //      happened when the canned-fallback pool was deleted: the pool had
            //      kept this branch unreachable, and removing it silently routed every
            //      exhausted strip into meaning 3.
            //
            //   3. FAILURE — GPT failed to produce content for a normal intent, or the
            //      reply was truncated at the model cap / arrived as broken JSON. Throw
            //      so the merchant gets needs_attention with the specific reason.
            //
            // PR B (#139) initially threw for ALL empty replies, which spammed Sentry
            // and merchant notifications with every legitimate "ignore the troll"
            // case (107 events in 3h on a single page after deploy). Intent-aware.
            const isIntentionalEmpty = validated.intent === 'OFFENSIVE' || validated.intent === 'SPAM_OR_IRRELEVANT';
            if (!validated.reply && !isIntentionalEmpty && !isHeldEmptyReply(validated.flags)) {
                recordAiFailedBeforeLog(request.context?.pipeline, config.openai.model, 'AiEmptyReplyError');
                // The truncation-specific message reaches the backend's flag_meta
                // (reconstructed from the wire), so a recurrence is diagnosable
                // without replaying the pipeline.
                throw new AiEmptyReplyError(finishReason === 'length'
                    ? 'Reply truncated at the model output limit even after a brevity retry'
                    : undefined);
            }

            // Mark replies that only exist thanks to the truncation retry — the
            // backend strips this into a quiet informational badge (never an
            // alarm flag) so the merchant can see their Business Info produces
            // over-long replies. Riding the flags array persists it through both
            // AI caches for free (cached copies ARE the shortened text).
            const responseFlags = wasTruncated
                ? [...(validated.flags ?? []), 'reply_shortened']
                : validated.flags;

            return {
                reply: validated.reply,
                // Prefer GPT's declared reply language (strict schema), fall back to input-based detection.
                language: validated.language || request.language || detectedLanguage,
                // Token counts include the truncated first attempt when a retry
                // happened — both calls were billed, and ai_usage_log / the admin
                // cost panel must see the real spend.
                tokensUsed: addTokens(completion.usage?.total_tokens, discardedUsage?.total_tokens),
                tokensIn: addTokens(completion.usage?.prompt_tokens, discardedUsage?.prompt_tokens),
                tokensInCached: addTokens(
                    completion.usage?.prompt_tokens_details?.cached_tokens,
                    discardedUsage?.prompt_tokens_details?.cached_tokens,
                ),
                tokensOut: addTokens(completion.usage?.completion_tokens, discardedUsage?.completion_tokens),
                intent: validated.intent,
                confidence: validated.confidence,
                flags: responseFlags,
                gender: validated.gender,
                genderBasis: validated.genderBasis,
                usedName: validated.usedName,
            };
        } catch (error) {
            // Preserve typed errors — they must reach backend's reconstruction
            // logic with their `name` intact. Re-throw without wrapping.
            // Check by name (not instanceof) to be robust against vitest module
            // resetting that can null the class references mid-test.
            if (error instanceof Error && AI_TYPED_ERROR_NAMES.has(error.name)) {
                throw error;
            }
            // Anything else (network glitch, unknown OpenAI shape, etc.) is captured
            // for triage and rethrown. Backend's catch will decide retry vs flag
            // via the existing isTransientAiError classifier.
            Sentry.captureException(error instanceof Error ? error : new Error('OpenAI API error'), { tags: { service: 'openai' } });
            throw error;
        }
    }

    /**
     * One chat-completion request with the reply schema, its own timeout, and
     * its own metrics pair. Every invocation is a separate billed OpenAI
     * request, so each carries its own withAiMetrics wrap (one attempts +
     * returns pair per request — the Phase 6.5 counter invariant). The
     * truncation retry in generateReply is the only second caller.
     */
    private async createCompletion(
        messages: OpenAI.ChatCompletionMessageParam[],
        pipeline?: string,
    ): Promise<OpenAI.ChatCompletion> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.openai.timeoutMs);

        try {
            // withAiMetrics handles attempts / returns / failed_before_log emit.
            // The catch below only re-throws timeouts as typed AiTimeoutError
            // (backend's BullMQ uses the type to decide retry).
            return await withAiMetrics(
                pipeline,
                config.openai.model,
                () => Sentry.startSpan(
                    { name: 'ai.llm.call', op: 'ai' },
                    () => this.client!.chat.completions.create({
                        model: config.openai.model,
                        messages,
                        max_tokens: config.openai.maxTokens,
                        temperature: config.openai.temperature,
                        top_p: config.openai.topP,
                        // Penalties intentionally zeroed for structured outputs. With
                        // `response_format: json_schema` the model MUST reuse tokens like
                        // `"`, `{`, `:`, and the schema's key names many times per response.
                        // Non-zero frequency_penalty / presence_penalty bias the model
                        // against exactly those required tokens, which produces unstable
                        // output — most visibly, GPT occasionally emitted the entire JSON
                        // object twice back-to-back, breaking JSON.parse and triggering
                        // false `invalid_json` flags + medium-confidence downgrades
                        // (see eval test #46, 2026-05-20). OpenAI's own guidance for
                        // structured outputs is to leave both penalties at 0; the schema
                        // is already constraining structure, so penalties have no upside
                        // here and a real downside.
                        frequency_penalty: 0,
                        presence_penalty: 0,
                        response_format: {
                            type: 'json_schema',
                            json_schema: {
                                name: 'ai_reply',
                                strict: true,
                                schema: {
                                    type: 'object',
                                    properties: {
                                        reply: { type: 'string' },
                                        intent: {
                                            type: 'string',
                                            enum: ['QUESTION', 'COMPLIMENT', 'COMPLAINT', 'PURCHASE_INTENT',
                                                   'GREETING', 'BUSINESS_INQUIRY', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT'],
                                        },
                                        confidence: {
                                            type: 'string',
                                            enum: ['high', 'medium', 'low'],
                                        },
                                        flags: {
                                            type: 'array',
                                            items: { type: 'string' },
                                        },
                                        hedging: { type: 'boolean' },
                                        // Gender self-report (v53): lets the backend learn a
                                        // name→gender consensus map and gender-bucket the DM
                                        // exact cache. Grammar-enforced on every call; only
                                        // meaningful for Arabic DMs (see promptBuilder).
                                        gender: {
                                            type: 'string',
                                            enum: ['m', 'f', 'unknown'],
                                        },
                                        gender_basis: {
                                            type: 'string',
                                            enum: ['self', 'name', 'unclear'],
                                        },
                                        used_name: { type: 'boolean' },
                                        // Price-math self-report (v56): when the reply quotes a
                                        // COMPUTED total (cart items + delivery, quantity × unit
                                        // price), the model lists the breakdown so the validator
                                        // can verify each unit price against Business Info and
                                        // the arithmetic (replyValidator Check 1b). null when the
                                        // reply quotes no computed total. Strict mode: nullable
                                        // union + listed in `required`.
                                        price_math: {
                                            type: ['array', 'null'],
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    total: { type: 'number' },
                                                    terms: {
                                                        type: 'array',
                                                        items: {
                                                            type: 'object',
                                                            properties: {
                                                                unit: { type: 'number' },
                                                                qty: { type: 'number' },
                                                            },
                                                            required: ['unit', 'qty'],
                                                            additionalProperties: false,
                                                        },
                                                    },
                                                },
                                                required: ['total', 'terms'],
                                                additionalProperties: false,
                                            },
                                        },
                                        language: {
                                            type: 'string',
                                            // ISO 639-1 codes. Includes scripts the detector now
                                            // recognizes via Unicode properties: my (Burmese),
                                            // th (Thai), zh (Chinese), ja (Japanese), ko (Korean),
                                            // ru (Russian), hi (Hindi), he (Hebrew). With the
                                            // prompt instructed to mirror the customer's language
                                            // rather than fall back to English, strict-mode
                                            // structured outputs need the enum to actually allow
                                            // those values — otherwise GPT is forced to lie about
                                            // what it wrote.
                                            enum: ['ar', 'en', 'sv', 'de', 'fr', 'es', 'tr', 'my', 'th', 'zh', 'ja', 'ko', 'ru', 'hi', 'he'],
                                        },
                                    },
                                    required: ['reply', 'intent', 'confidence', 'flags', 'hedging', 'gender', 'gender_basis', 'used_name', 'price_math', 'language'] as const,
                                    additionalProperties: false,
                                },
                            },
                        },
                    }, { signal: controller.signal }),
                ),
                // Timeouts and quota exhaustion get distinct error_classes so the
                // breakdown script can separate them from generic API errors.
                // Timeout detection lives in @jawab24/shared's aiTimeout (see it
                // for WHY it reads the signal rather than the error).
                classifyTimeoutAbort(controller.signal,
                    (e) => (isInsufficientQuotaError(e) ? 'AiQuotaError' : 'OpenAIApiError')),
            );
        } catch (e) {
            // withAiMetrics already emitted failed_before_log. Re-throw typed
            // errors so backend BullMQ classifies them correctly.
            if (isTimeoutAbort(controller.signal)) {
                throw new AiTimeoutError(config.openai.timeoutMs);
            }
            // 429 insufficient_quota — account out of credit. Throw the typed
            // error so the backend PARKS the job (long-delay re-enqueue) and
            // alerts, instead of burning fast retries and flagging the row.
            if (isInsufficientQuotaError(e)) {
                throw new AiQuotaExhaustedError();
            }
            throw e;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Build messages array including conversation history, trimmed to token budget.
     *
     * History is forwarded verbatim — we used to keyword-compress older turns to save
     * tokens, but that made the bot re-ask for customer-provided data (names, phones,
     * etc.) because compression destroyed the structural context. For realistic
     * conversation lengths, even long WhatsApp threads up to ~500 turns, token cost
     * stays well under the 24k cap. The trim-oldest loop further down is the sole
     * safety net for the rare extreme case.
     */
    buildMessages(request: GenerateRequest, systemPrompt: string): { messages: OpenAI.ChatCompletionMessageParam[]; tokenInfo: TokenInfo } {
        const messages: OpenAI.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
        ];

        // Conversation history flows through verbatim — preserves the natural
        // alternating user/assistant rhythm GPT expects. We used to compress older
        // turns to save tokens, but compression (any form — keyword summary, per-turn
        // injection, or bundled summary) confused GPT into re-asking for data the
        // customer already provided. For realistic conversation lengths (even long
        // WhatsApp threads up to ~500 turns), token cost stays well under the 24k cap.
        // The trim-oldest loop below is the sole safety net for extreme cases.
        const historyMessages: OpenAI.ChatCompletionMessageParam[] = [];
        if (request.context?.conversationHistory && request.context.conversationHistory.length > 0) {
            for (const msg of request.context.conversationHistory) {
                historyMessages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content,
                });
            }
        }

        const userPrompt = buildUserPrompt(request);
        const userMessage: OpenAI.ChatCompletionMessageParam = { role: 'user', content: userPrompt };

        // Calculate token usage and trim history if over budget
        const systemTokens = estimateTokens(systemPrompt);
        const userTokens = estimateTokens(userPrompt);
        let historyTokens = historyMessages.reduce((sum, m) => sum + estimateTokens(m.content as string), 0);
        let totalTokens = systemTokens + historyTokens + userTokens;

        // Trim oldest history messages first until under budget
        while (totalTokens > MAX_INPUT_TOKENS && historyMessages.length > 0) {
            const removed = historyMessages.shift()!;
            const removedTokens = estimateTokens(removed.content as string);
            historyTokens -= removedTokens;
            totalTokens -= removedTokens;
        }

        messages.push(...historyMessages, userMessage);

        const knowledgeBase = request.context?.knowledgeBase || '';
        const chunkCount = request.context?.retrievedChunks?.length ?? 0;
        const tokenInfo: TokenInfo = {
            estimated_tokens_in: totalTokens,
            max_input_tokens: MAX_INPUT_TOKENS,
            history_count: historyMessages.length,
            kb_truncated: chunkCount === 0 && knowledgeBase.length > KB_MAX_CHARS,
            kb_original_chars: chunkCount > 0 ? 0 : knowledgeBase.length,
            chunk_count: chunkCount,
            prompt_version: PROMPT_VERSION,
        };

        return { messages, tokenInfo };
    }

    /**
     * Build the full system prompt (static prefix + dynamic suffix).
     * Delegates to promptBuilder — kept as a method so external callers
     * (ecommerceToolHandler, providers/index) keep their existing call site.
     */
    buildSystemPrompt(request: GenerateRequest): string {
        return buildSystemPromptText(request);
    }

    /**
     * Post-reply validation. Delegates to replyValidator.
     * @internal Exposed for provider abstraction — approved callers: providers/index.ts
     * and ecommerceToolHandler.ts (tool-loop reply validation). Do not call elsewhere.
     */
    validateReply(parsed: ParsedReply, request: GenerateRequest, opts?: { skipPriceCheck?: boolean }): ValidatedReply {
        return runValidateReply(parsed, request, opts);
    }
}

export const openaiService = new OpenAIService();
