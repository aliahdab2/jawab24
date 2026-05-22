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
import * as Sentry from '@sentry/node';
import { config } from '../config';
import { openaiService, type GenerateRequest, type GenerateResponse } from './openai';
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

const ECOMMERCE_TOOLS: OpenAI.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'lookup_order',
            description: 'Check if an order exists by order number. Returns a verification challenge — you must then ask the customer for their name or phone and call verify_and_get_order.',
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
            description: 'Check if a shipment exists for an order. Returns a verification challenge — you must then ask the customer for their name or phone and call verify_and_get_shipment.',
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
            description: 'Check real-time stock availability for a product. No identity verification needed — this is public information.',
            parameters: {
                type: 'object',
                properties: {
                    product_name: {
                        type: 'string',
                        description: 'Product name or keyword to search for',
                    },
                    variant: {
                        type: 'string',
                        description: 'Specific variant to check (size, color, etc.)',
                    },
                },
                required: ['product_name'],
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

// --- Catalog Tools (Stage 2.3b of KB restructure) ---
// Used when the page has ≥1 non-archived catalog_items row. Surfaced
// independently from the e-commerce tools so catalog-only merchants
// (training institutes, salons, restaurants) get the structured-data
// path without needing a Shopify/Salla store linked.

const CATALOG_TOOLS: OpenAI.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'search_entities',
            description: 'Search the merchant\'s structured catalog (courses, services, products, events, branches, packages) by keyword. Use when the customer asks about a specific item by name or topic.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Keyword or phrase to match against item name/description (e.g. "IELTS", "haircut")' },
                    type: { type: 'string', enum: ['course', 'product', 'service', 'event', 'branch', 'package'], description: 'Optional: restrict results to one item type.' },
                    price_min_minor: { type: 'number', description: 'Optional: minimum price in minor units (e.g. 100000 = 1000.00 in the item\'s currency).' },
                    price_max_minor: { type: 'number', description: 'Optional: maximum price in minor units.' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_entity_details',
            description: 'Get the full record for one catalog item by id (returned by search_entities or list_active_entities). Use to retrieve description, schedule, metadata.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'UUID of the catalog item.' },
                },
                required: ['id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_active_entities',
            description: 'List all currently-available items in the catalog. Excludes expired courses/events (past endsAt) and archived items automatically. Use for open-ended questions like "what courses do you offer?", "what services do you have?", "ما هي الدورات المتاحة؟".',
            parameters: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['course', 'product', 'service', 'event', 'branch', 'package'], description: 'Optional: restrict to one item type.' },
                    limit: { type: 'number', description: 'Optional: max results (default 10, max 25).' },
                },
            },
        },
    },
];

const CATALOG_PROMPT_ADDITION = `

CATALOG TOOLS:
The merchant has a structured catalog you can query for current, freshness-filtered data. ALWAYS prefer calling a catalog tool over guessing or quoting <business_knowledge>, because the tool returns live prices, schedules, and availability — the static KB may be stale.

WHEN TO USE CATALOG TOOLS:
- Customer asks what is offered: "what courses do you have?", "شو عندكم دورات؟", "ما هي خدماتكم؟" → list_active_entities
- Customer mentions a specific item by name or keyword: "is the IELTS course available?", "كم سعر الحلاقة؟" → search_entities
- Customer asks for details about a specific item already mentioned in the conversation → get_entity_details
- Customer asks about price, schedule, enrollment, or availability of a known item → search_entities then get_entity_details

CRITICAL: list_active_entities AUTOMATICALLY filters out expired items. If a tool returns an item, it is currently available — do NOT add caveats like "if it's still open". If the tool returns NO matching items, the merchant does not currently offer it; say so clearly instead of inventing one.

When quoting prices: priceMinor is in minor units (cents). Divide by 100 and format with the item's currency code.
`;

// --- Tool-specific system prompt additions ---

const TOOL_PROMPT_ADDITION = `

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
`;

/**
 * Pick the active tool set + prompt addition for one request, based on which
 * tool families the backend has enabled in the request context. Either or
 * both flags may be set; we default to "ecommerce only" when neither is
 * present to preserve legacy callers that don't yet set the flags.
 */
function selectToolsForRequest(request: GenerateRequest): {
    tools: OpenAI.ChatCompletionTool[];
    promptAddition: string;
} {
    const ecommerceOn = request.context?.ecommerceToolsEnabled !== false; // default-on legacy
    const catalogOn = !!request.context?.catalogToolsEnabled;

    // When catalog is the ONLY signal, drop the e-commerce defs entirely.
    const catalogOnly = catalogOn && !request.context?.ecommerceToolsEnabled;

    const tools: OpenAI.ChatCompletionTool[] = [];
    let promptAddition = '';
    if (!catalogOnly && ecommerceOn) {
        tools.push(...ECOMMERCE_TOOLS);
        promptAddition += TOOL_PROMPT_ADDITION;
    }
    if (catalogOn) {
        tools.push(...CATALOG_TOOLS);
        promptAddition += CATALOG_PROMPT_ADDITION;
    }
    return { tools, promptAddition };
}

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
        const { tools, promptAddition } = selectToolsForRequest(request);
        const baseSystemPrompt = openaiService.buildSystemPrompt(request);
        const systemPrompt = baseSystemPrompt + promptAddition;

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
                        tools,
                    }, { signal: controller.signal }),
                ),
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
        const { tools, promptAddition } = selectToolsForRequest(request);
        const baseSystemPrompt = openaiService.buildSystemPrompt(request);
        const systemPrompt = baseSystemPrompt + promptAddition;

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
                        // Include tools so AI can call verify_and_get_* in Phase 2
                        // NOTE: Cannot use response_format: json_schema with tools — parse JSON manually
                        tools,
                    }, { signal: controller.signal }),
                ),
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

        let parsed: { reply: string; intent?: string; confidence?: string; flags?: string[] };
        try {
            parsed = JSON.parse(content);
        } catch {
            parsed = { reply: content, intent: 'QUESTION', confidence: 'medium', flags: ['invalid_json'] };
        }

        return {
            reply: parsed.reply || 'Thank you for your patience!',
            language: detectedLanguage,
            model: config.openai.model,
            tokensUsed: completion.usage?.total_tokens,
            tokensIn: completion.usage?.prompt_tokens,
            tokensInCached: completion.usage?.prompt_tokens_details?.cached_tokens,
            tokensOut: completion.usage?.completion_tokens,
            intent: parsed.intent,
            confidence: parsed.confidence,
            flags: parsed.flags,
        };
    } catch (error) {
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

/** Parse a direct (non-tool) reply from OpenAI content string */
function parseDirectReply(
    content: string,
    request: GenerateRequest,
    completion: OpenAI.ChatCompletion,
): ToolEnabledResponse {
    let parsed: { reply: string; intent?: string; confidence?: string; flags?: string[] };
    try {
        parsed = JSON.parse(content);
    } catch {
        parsed = { reply: content, intent: 'QUESTION', confidence: 'medium', flags: [] };
    }

    return {
        reply: parsed.reply || content,
        language: request.language || 'en',
        model: config.openai.model,
        tokensUsed: completion.usage?.total_tokens,
        tokensIn: completion.usage?.prompt_tokens,
        tokensInCached: completion.usage?.prompt_tokens_details?.cached_tokens,
        tokensOut: completion.usage?.completion_tokens,
        intent: parsed.intent,
        confidence: parsed.confidence,
        flags: parsed.flags,
    };
}
