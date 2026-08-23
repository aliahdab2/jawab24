/**
 * E-Commerce Tool Handler for AI Worker
 *
 * Handles OpenAI function/tool calling for e-commerce actions (order lookup,
 * shipment tracking, inventory check). This is a SEPARATE file from openai.ts
 * to keep the existing reply generation logic completely untouched.
 *
 * SECURITY: Two-phase verification flow:
 *   Phase 1: lookup_order / track_shipment → returns "order found, ask for identity"
 *   Phase 2: verify_and_get_order / verify_and_get_shipment → backend verifies server-side
 *
 * The AI never receives sensitive data until the backend confirms identity.
 */
import OpenAI from 'openai';
import { withAiMetrics } from '../lib/aiMetrics';
import { classifyTimeoutAbort } from '@jawab24/shared';
import * as Sentry from '@sentry/node';
import { config } from '../config';
import { openaiService, assertDeliverableOrThrow, type GenerateRequest, type GenerateResponse } from './openai';
import { parseReplyContent } from './reply/parseReplyContent';
import { AiEmptyReplyError } from '../lib/errors';
import type { ParsedReply, ValidatedReply } from './reply/types';
import type { EcommerceToolResult } from '@jawab24/shared';

// --- Singleton OpenAI client (reuses config, avoids per-request instantiation) ---

let _toolClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI | null {
    if (!config.openai.apiKey || config.openai.apiKey.length === 0) return null;
    if (!_toolClient) {
        _toolClient = new OpenAI({ apiKey: config.openai.apiKey });
    }
    return _toolClient;
}

// --- Response type for tool-enabled generation ---

export interface ToolEnabledResponse {
    /** When tools are called, this contains the tool requests */
    toolCalls?: Array<{ name: string; arguments: Record<string, string> }>;
    /** When no tools are needed, this is the normal reply */
    reply?: string;
    language?: string;
    /** Model name actually used by the worker — surfaced so the backend logs the correct unit price. */
    model?: string;
    tokensUsed?: number;
    tokensIn?: number;
    /** Subset of tokensIn that hit OpenAI's prompt cache (billed at the model's cached rate — see backend aiPricing.ts). */
    tokensInCached?: number;
    tokensOut?: number;
    intent?: string;
    confidence?: string;
    flags?: string[];
}

// --- OpenAI Tool Definitions (5 tools: 3 Phase-1 + 2 Phase-2) ---

// Exported for the CI guard in test/ecommerceToolHandler.test.ts — the order
// tools' SCOPING (specific-order only, general delivery questions answered from
// [store_policies]) is load-bearing behaviour, not cosmetic wording.
export const ECOMMERCE_TOOLS: OpenAI.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'lookup_order',
            description: 'Check if a SPECIFIC existing order exists by its order number. Returns a verification challenge — you must then ask the customer for their name or phone and call verify_and_get_order. Use this ONLY when the customer refers to a particular order they already placed (they give an order number, or clearly mean their own order). Do NOT use it for a GENERAL question about delivery times, shipping cost, or the shipping policy ("how long does delivery take?", "when do orders usually arrive?") — answer those from [store_policies] in the prompt, then offer to check their specific order if they give the order number.',
            parameters: {
                type: 'object',
                properties: {
                    order_number: {
                        type: 'string',
                        description: 'The order number (e.g. "1234" or "#1234")',
                    },
                },
                required: ['order_number'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'track_shipment',
            description: 'Check if a shipment exists for a SPECIFIC existing order. Returns a verification challenge — you must then ask the customer for their name or phone and call verify_and_get_shipment. Use this ONLY when the customer is tracking a particular order they already placed. Do NOT use it for a GENERAL question about how long delivery takes or the shipping policy — answer those from [store_policies] in the prompt, then offer to track their specific order if they give the order number.',
            parameters: {
                type: 'object',
                properties: {
                    order_number: {
                        type: 'string',
                        description: 'The order number to track',
                    },
                },
                required: ['order_number'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_inventory',
            description: 'Check stock availability, price and link for ONE product the customer asked about. No identity verification needed — this is public information. The product is identified by the backend: pass product_id when the catalog entry shows one (the value after "ID:"), otherwise pass the customer\'s own wording as product_name. If the result is error "ambiguous_product", it lists the candidates — name them and ask which one; never pick for the customer. If the result is error "product_not_found", the store does not carry it — say so plainly and never substitute another product.',
            parameters: {
                type: 'object',
                properties: {
                    product_id: {
                        type: 'string',
                        description: 'The id shown after "ID:" in a [product: …] catalog entry. Prefer this whenever it is listed.',
                    },
                    product_name: {
                        type: 'string',
                        description: 'Only when no id is available: the product as the customer worded it (their language and spelling are fine).',
                    },
                    variant: {
                        type: 'string',
                        description: 'Specific variant to check (size, color, etc.)',
                    },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'verify_and_get_order',
            description: 'After the customer provides their name or phone number, call this to verify their identity and get the full order details. Only call this AFTER you received the customer\'s verification answer.',
            parameters: {
                type: 'object',
                properties: {
                    order_number: {
                        type: 'string',
                        description: 'The order number from the earlier lookup',
                    },
                    provided_name: {
                        type: 'string',
                        description: 'The name the customer provided for verification',
                    },
                    provided_phone: {
                        type: 'string',
                        description: 'The phone number the customer provided for verification',
                    },
                },
                required: ['order_number'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'verify_and_get_shipment',
            description: 'After the customer provides their name or phone number, call this to verify their identity and get the full shipment tracking details. Only call this AFTER you received the customer\'s verification answer.',
            parameters: {
                type: 'object',
                properties: {
                    order_number: {
                        type: 'string',
                        description: 'The order number from the earlier tracking request',
                    },
                    provided_name: {
                        type: 'string',
                        description: 'The name the customer provided for verification',
                    },
                    provided_phone: {
                        type: 'string',
                        description: 'The phone number the customer provided for verification',
                    },
                },
                required: ['order_number'],
            },
        },
    },
];

// --- Tool-specific system prompt additions ---

export const TOOL_PROMPT_ADDITION = `

ECOMMERCE TOOLS:
You have access to tools that can look up real-time data from the merchant's online store.

WHEN TO USE TOOLS:
- Customer asks about order status: "where's my order?", "وين طلبي؟", mentions an order number
- Customer asks about delivery: "when will it arrive?", "متى يوصل؟"
- Customer asks about stock: "is X in stock?", "هل متوفر؟", "do you have X?"
- Customer asks about payment status: "did my payment go through?", "وصل الدفع؟"

WHEN NOT TO USE TOOLS:
- General product questions already answered by <business_knowledge>
- Greetings, compliments, complaints (handle normally)
- Customer hasn't provided enough info (ask them first)

IDENTITY VERIFICATION FLOW (CRITICAL — you MUST follow this exactly):
1. When customer asks about an order, call lookup_order or track_shipment first.
2. The tool will confirm the order exists but will NOT return order details.
3. You MUST then ask the customer: "To verify your identity, could you tell me the name on the order or the phone number used when ordering?" (adapt to conversation language)
4. After the customer responds with their name or phone, call verify_and_get_order or verify_and_get_shipment with their answer.
5. If verification succeeds, share the order details from the response.
6. If verification fails (error: "verification_failed"), say: "The information doesn't match our records. Please check your order confirmation email or contact us directly."

CRITICAL RULES:
- NEVER skip the verification step. NEVER make up order details.
- NEVER call verify_and_get_* without first getting the customer's name or phone.
- For check_inventory: No verification needed — stock info is public.
- check_inventory identifies the product for you. Pass product_id when the catalog entry shows "ID:"; otherwise pass the customer's own words as product_name.
- If check_inventory returns error "ambiguous_product", its "candidates" are the products the customer may mean: name them (title and price) and ask which one. NEVER pick one yourself.
- If check_inventory returns error "product_not_found", the store does not carry that product. Say so plainly; NEVER answer with a different product instead.
- In a check_inventory result, "source": "local" means the figure is from the store's last update (its time is "asOf", when present); "source": "live" means the store was asked just now. Either is fine to state; do not mention the word "sync" to the customer.
`;

/**
 * Generate a reply with e-commerce tools available.
 *
 * If the AI decides to call a tool, returns { toolCalls: [...] }.
 * If no tools are needed, returns a normal { reply, intent, ... } response.
 *
 * The existing openaiService.generateReply() is NOT modified — this method
 * builds its own OpenAI call with tools enabled.
 */
export async function generateWithTools(request: GenerateRequest): Promise<ToolEnabledResponse> {
    const client = getOpenAIClient();
    if (!client) {
        const fallback = await openaiService.generateReply(request);
        return fallback;
    }

    try {
        const baseSystemPrompt = openaiService.buildSystemPrompt(request);
        const systemPrompt = baseSystemPrompt + TOOL_PROMPT_ADDITION;

        const { messages } = openaiService.buildMessages(request, systemPrompt);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.openai.timeoutMs);

        let completion: OpenAI.ChatCompletion;
        try {
            completion = await withAiMetrics(request.context?.pipeline, config.openai.model, () =>
                Sentry.startSpan(
                    { name: 'ai.llm.call.tools', op: 'ai' },
                    () => client.chat.completions.create({
                        model: config.openai.model,
                        messages,
                        max_tokens: config.openai.maxTokens,
                        temperature: config.openai.temperature,
                        tools: ECOMMERCE_TOOLS,
                    }, { signal: controller.signal }),
                ),
                // Without a classifier withAiMetrics defaults to 'OpenAIApiError',
                // so tool-loop timeouts were booked identically to genuine API
                // errors — the same Phase 6.5 blind spot as the name-sniffing bug,
                // reached by omission rather than by a broken check.
                classifyTimeoutAbort(controller.signal),
            );
        } finally {
            clearTimeout(timeout);
        }

        const choice = completion.choices[0];

        if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
            const toolCalls = choice.message.tool_calls
                .filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
                .map(tc => ({
                    name: tc.function.name,
                    arguments: safeParseArgs(tc.function.arguments),
                }));

            return {
                toolCalls,
                model: config.openai.model,
                tokensUsed: completion.usage?.total_tokens,
                tokensIn: completion.usage?.prompt_tokens,
                tokensInCached: completion.usage?.prompt_tokens_details?.cached_tokens,
                tokensOut: completion.usage?.completion_tokens,
            };
        }

        const content = choice?.message?.content?.trim() || '';
        return parseDirectReply(content, request, completion);
    } catch (error) {
        Sentry.captureException(error instanceof Error ? error : new Error('OpenAI tool call error'), {
            tags: { service: 'openai', feature: 'ecommerce-tools' },
        });

        const fallback = await openaiService.generateReply(request);
        return fallback;
    }
}

/**
 * Complete generation after tool results are available.
 *
 * Sends the original messages + tool call + tool results back to OpenAI,
 * then parses the final reply with the standard JSON schema format.
 */
export async function generateWithToolResults(
    request: GenerateRequest,
    toolResults: EcommerceToolResult[],
    originalToolCalls: Array<{ name: string; arguments: Record<string, string> }>,
): Promise<GenerateResponse> {
    const client = getOpenAIClient();
    if (!client) {
        return openaiService.generateReply(request);
    }

    try {
        const baseSystemPrompt = openaiService.buildSystemPrompt(request);
        const systemPrompt = baseSystemPrompt + TOOL_PROMPT_ADDITION;

        const { messages } = openaiService.buildMessages(request, systemPrompt);

        // Add assistant message with tool_calls
        const toolCallMessages: OpenAI.ChatCompletionMessageParam[] = [
            {
                role: 'assistant',
                content: null,
                tool_calls: originalToolCalls.map((tc, i) => ({
                    id: `call_${i}`,
                    type: 'function' as const,
                    function: {
                        name: tc.name,
                        arguments: JSON.stringify(tc.arguments),
                    },
                })),
            },
        ];

        // Add tool result messages
        const toolResultMessages: OpenAI.ChatCompletionMessageParam[] = toolResults.map((result, i) => ({
            role: 'tool' as const,
            tool_call_id: `call_${i}`,
            content: JSON.stringify(result),
        }));

        const allMessages = [...messages, ...toolCallMessages, ...toolResultMessages];

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.openai.timeoutMs);

        let completion: OpenAI.ChatCompletion;
        try {
            completion = await withAiMetrics(request.context?.pipeline, config.openai.model, () =>
                Sentry.startSpan(
                    { name: 'ai.llm.call.tools.final', op: 'ai' },
                    () => client.chat.completions.create({
                        model: config.openai.model,
                        messages: allMessages,
                        max_tokens: config.openai.maxTokens,
                        temperature: config.openai.temperature,
                        // Include tools so AI can call verify_and_get_* in Phase 2.
                        // Deliberately NO response_format on either tool call: the API
                        // accepts it alongside tools, but it suppresses tool calling
                        // (measured 10/10 → 3/10, see reply/replySchema.ts). The envelope
                        // is parsed by parseReplyContent, which never passes raw text.
                        tools: ECOMMERCE_TOOLS,
                    }, { signal: controller.signal }),
                ),
                // See the note on the Phase-1 tool call above — same reasoning.
                classifyTimeoutAbort(controller.signal),
            );
        } finally {
            clearTimeout(timeout);
        }

        const choice = completion.choices[0];

        // Phase 2: AI might call verify_and_get_* tools after Phase 1 results
        if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
            const toolCalls = choice.message.tool_calls
                .filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
                .map(tc => ({
                    name: tc.function.name,
                    arguments: safeParseArgs(tc.function.arguments),
                }));

            // Return tool calls for the backend to execute (Phase 2 verification)
            return {
                reply: '',
                language: request.language || 'en',
                toolCalls,
                model: config.openai.model,
                tokensUsed: completion.usage?.total_tokens,
                tokensIn: completion.usage?.prompt_tokens,
                tokensInCached: completion.usage?.prompt_tokens_details?.cached_tokens,
                tokensOut: completion.usage?.completion_tokens,
            } as GenerateResponse & { toolCalls: Array<{ name: string; arguments: Record<string, string> }> };
        }

        const content = choice?.message?.content?.trim() || '';
        const detectedLanguage = request.language || 'en';

        const { parsed } = parseReplyContent(content, {
            site: 'tools_final', pipeline: request.context?.pipeline, finishReason: choice?.finish_reason,
        });

        // Validate the final reply. Skip the price check: prices here are from
        // verified tool results (the ground truth), and a computed total would
        // false-flag against the static KB → destructive fallback swap.
        const v = validateToolReply(parsed, request, { skipPriceCheck: true });
        // An empty reply here is a failure the merchant must see: the verified
        // order/shipment data only exists in THIS call's context, so the plain
        // regeneration in the catch below could not answer the question — it
        // would only hide the failure behind a generic reply. Rethrown below.
        assertDeliverableOrThrow(v, request.context?.pipeline);
        return {
            reply: v.reply,
            language: detectedLanguage,
            model: config.openai.model,
            tokensUsed: completion.usage?.total_tokens,
            tokensIn: completion.usage?.prompt_tokens,
            tokensInCached: completion.usage?.prompt_tokens_details?.cached_tokens,
            tokensOut: completion.usage?.completion_tokens,
            intent: v.intent,
            confidence: v.confidence,
            flags: v.flags,
        };
    } catch (error) {
        // Not a transport failure: the model answered and the answer was empty.
        // Propagate so the backend flags the row (ai_empty_reply) instead of
        // regenerating without the tool results (see assertDeliverableOrThrow above).
        if (error instanceof AiEmptyReplyError) throw error;
        Sentry.captureException(error instanceof Error ? error : new Error('OpenAI tool results error'), {
            tags: { service: 'openai', feature: 'ecommerce-tools' },
        });
        return openaiService.generateReply(request);
    }
}

// --- Utilities ---

/** Safely parse tool call arguments from OpenAI */
function safeParseArgs(argsString: string): Record<string, string> {
    try {
        return JSON.parse(argsString);
    } catch {
        return {};
    }
}

/**
 * Run the standard post-reply validator on a tool-loop reply — the same guard
 * the multi-provider path applies (language, comment length, self-identification
 * strip, and — off the tool path — price grounding). Closes the hole where both
 * tool-loop exits returned unvalidated.
 *
 * `skipPriceCheck` is set for the Phase-2 (post-tool-results) reply: its prices
 * come from verified verify_and_get_* tool results, and a computed total isn't
 * literally in the static KB, so the heuristic price check would false-flag it
 * — and price_not_in_kb triggers a destructive fallback swap in the backend.
 * The tool result IS the price ground truth there. The Phase-1 direct reply
 * (no tool called → answered from static KB/catalog) keeps the full check.
 */
function validateToolReply(
    parsed: ParsedReply,
    request: GenerateRequest,
    opts?: { skipPriceCheck?: boolean },
): Pick<ValidatedReply, 'reply' | 'intent' | 'confidence' | 'flags'> {
    const validated = openaiService.validateReply(parsed, request, opts);
    return {
        reply: validated.reply,
        intent: validated.intent,
        confidence: validated.confidence,
        flags: validated.flags,
    };
}

/**
 * Parse a direct (non-tool) reply from OpenAI content string.
 *
 * This is the site that leaked on 2026-08-23: the model answered the prod turn
 * as prose FOLLOWED by the JSON envelope, `JSON.parse` threw, and the old
 * fallback sent the whole content — with no flag, so the row read as clean.
 * Now the shared parser salvages the envelope's `reply`, and an empty result
 * throws: the caller's catch regenerates on the plain path (strict grammar),
 * which is a fine answer for a direct turn — no tool context is lost.
 */
function parseDirectReply(
    content: string,
    request: GenerateRequest,
    completion: OpenAI.ChatCompletion,
): ToolEnabledResponse {
    const { parsed } = parseReplyContent(content, {
        site: 'tools_direct', pipeline: request.context?.pipeline, finishReason: completion.choices[0]?.finish_reason,
    });

    // Phase-1 direct reply (model answered without calling a tool) → no tool
    // results, standard KB/catalog grounding.
    const v = validateToolReply(parsed, request);
    assertDeliverableOrThrow(v, request.context?.pipeline);
    return {
        reply: v.reply,
        language: request.language || 'en',
        model: config.openai.model,
        tokensUsed: completion.usage?.total_tokens,
        tokensIn: completion.usage?.prompt_tokens,
        tokensInCached: completion.usage?.prompt_tokens_details?.cached_tokens,
        tokensOut: completion.usage?.completion_tokens,
        intent: v.intent,
        confidence: v.confidence,
        flags: v.flags,
    };
}
