/**
 * E-Commerce Tool Loop — Backend Orchestrator
 *
 * Wraps the AI generation call with e-commerce tool execution.
 * When a linked store exists and the AI requests tool calls, this service:
 *   1. Calls AI worker with tools enabled → gets toolCalls or direct reply
 *   2. Executes tool calls against Shopify/Salla via ecommerceActions
 *   3. Sends tool results back to AI worker for final reply generation
 *   4. If AI returns more tool calls (Phase 2 verification), execute and loop once more
 *
 * SECURITY:
 * - Store ownership verified before tool execution
 * - Tool call names validated against whitelist
 * - Max 2 tool loop iterations (Phase 1 + Phase 2 verification)
 * - All tool executions are audit-logged
 *
 * IMPORTANT: This is a SEPARATE file from ai.ts. The existing AiService
 * (cache hierarchy, billing, etc.) is NOT modified. When no store is
 * connected, this service delegates directly to aiService — zero behavior change.
 */
import axios from 'axios';
import * as Sentry from '@sentry/node';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { aiService } from './ai';
import { logAiUsage } from './aiUsageLog';
import { recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { executeToolCall } from './ecommerceActions';
import { executeCatalogToolCall } from './catalogTools';
import { getStoreById } from './ecommerce';
import { buildProductCardsFromToolResults } from './reply/productCardBuilder';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';
import { AiToolLoopExhaustedError } from '../utils/fbGraphErrors';
import type { AiGenerateRequest, AiGenerateResponse } from '../types';
import type { AiPipeline } from '../types/aiPipeline';
import {
    ALL_VALID_TOOL_NAMES,
    VALID_CATALOG_TOOL_NAMES,
    type CatalogToolCall,
    type EcommerceToolCall,
    type EcommerceToolResult,
} from '@jawab24/shared';

/** Response shape from ai-worker /generate-with-tools and /generate-with-tool-results */
interface AiWorkerToolResponse {
    toolCalls?: Array<{ name: string; arguments: Record<string, string> }>;
    reply?: string;
    language?: string;
    /** Model used by the worker — surfaced so cost is computed against the right unit price. */
    model?: string;
    tokensUsed?: number;
    tokensIn?: number;
    /** Subset of tokensIn that hit OpenAI's prompt cache (billed at the model's cached rate — see aiPricing.ts). */
    tokensInCached?: number;
    tokensOut?: number;
    intent?: string;
    confidence?: string;
    flags?: string[];
}

const MAX_TOOL_CALLS_PER_ROUND = 3;
const MAX_TOOL_ROUNDS = 2; // Phase 1 + Phase 2 (verification)
const TOOL_LOOP_TIMEOUT_MS = 30_000;

/** Combined whitelist (ecommerce + catalog) — O(1) membership for filtering AI tool calls. */
const VALID_TOOL_SET: Set<string> = new Set(ALL_VALID_TOOL_NAMES);
const CATALOG_TOOL_SET: Set<string> = new Set(VALID_CATALOG_TOOL_NAMES);

/**
 * Dispatch one tool call to the right backend handler based on its name.
 * - Catalog tools (search_entities / get_entity_details / list_active_entities)
 *   read `catalog_items` scoped to the pageId — no store needed.
 * - E-commerce tools (lookup_order / track_shipment / check_inventory / verify_*)
 *   hit the linked Shopify/Salla/Zid store via storeId.
 */
async function dispatchTool(
    tc: { name: string; arguments: Record<string, string> },
    storeId: string | undefined,
    pageId: string | undefined,
): Promise<EcommerceToolResult> {
    if (CATALOG_TOOL_SET.has(tc.name)) {
        if (!pageId) {
            return { tool_name: tc.name, success: false, error: 'page_context_missing' };
        }
        return executeCatalogToolCall(pageId, tc as CatalogToolCall);
    }
    if (!storeId) {
        return { tool_name: tc.name, success: false, error: 'store_not_connected' };
    }
    return executeToolCall(storeId, tc as EcommerceToolCall);
}

/**
 * Fire-and-forget ai_usage_log write for one ai-worker tool-loop round.
 *
 * `pipeline` reflects which tool family this round used so Phase 6.5 cost
 * counters attribute correctly: `catalog_tools` for catalog-only flows,
 * `ecommerce_tools` when a store is involved (with or without catalog).
 */
function logToolRoundUsage(request: AiGenerateRequest, data: AiWorkerToolResponse, pipeline: AiPipeline): void {
    const model = data.model || config.ai.model || DEFAULT_AI_MODEL;
    const userId = request.context?.userId;
    if (!userId) {
        // No userId → can't attribute. Surface as a breadcrumb so a future plumbing
        // regression is visible in Sentry instead of silently dropping rows.
        Sentry.addBreadcrumb({
            category: 'ai_usage_log',
            level: 'warning',
            message: `${pipeline} usage skipped: no userId in context`,
            data: { pageId: request.context?.pageId },
        });
        recordAiFailedBeforeLog(pipeline, model, 'MissingUserId');
        return;
    }
    const tokensIn = data.tokensIn ?? 0;
    const tokensOut = data.tokensOut ?? 0;
    if (tokensIn === 0 && tokensOut === 0) {
        // Worker didn't report usage — expected on its internal fallback path,
        // but surface as a breadcrumb so a worker regression that silently stops
        // reporting tokens is visible in Sentry instead of becoming an invoice
        // surprise.
        Sentry.addBreadcrumb({
            category: 'ai_usage_log',
            level: 'warning',
            message: `${pipeline} usage skipped: worker reported zero tokens`,
            data: { pageId: request.context?.pageId, model: data.model },
        });
        recordAiFailedBeforeLog(pipeline, model, 'ZeroTokens');
        return;
    }
    logAiUsage({
        userId,
        pageId: request.context?.pageId,
        // Prefer the model the worker actually used; backend config is a safe fallback.
        model: data.model || config.ai.model || DEFAULT_AI_MODEL,
        tokensIn,
        cachedInputTokens: data.tokensInCached,
        tokensOut,
        cached: false,
        pipeline,
    }).catch(() => { /* logged via Sentry breadcrumb inside logAiUsage */ });
}

/**
 * Generate an AI reply with optional e-commerce tool execution.
 *
 * If ecommerceStoreId is in the request context and the AI requests tools,
 * this service executes them and sends results back for a final reply.
 *
 * If no store is connected or no tools are needed, delegates to
 * aiService.generateReply() — completely unchanged behavior.
 */
export async function generateReplyWithTools(
    request: AiGenerateRequest,
): Promise<AiGenerateResponse> {
    let storeId = request.context?.ecommerceStoreId;
    const catalogEnabled = !!request.context?.catalogToolsEnabled;
    const pageId = request.context?.pageId;

    // Need at least one signal to surface tools at all. If neither, fall back
    // to the no-tools flow — preserves existing behavior for vanilla replies.
    if (!storeId && !catalogEnabled) {
        return aiService.generateReply(request);
    }

    // When a store IS linked, verify it's active before entering the loop.
    // If the store is gone or inactive:
    //   - and catalog is available → degrade to catalog-only by clearing
    //     storeId. Otherwise the LLM still sees e-commerce tools, picks
    //     lookup_order, the dispatcher returns store_not_connected, and
    //     we've wasted a tool round (and possibly confused the LLM).
    //   - and catalog is NOT available → fall back to the no-tools path.
    if (storeId) {
        let storeUsable = false;
        try {
            const store = await getStoreById(storeId);
            storeUsable = !!store && !!store.isActive;
        } catch {
            storeUsable = false;
        }
        if (!storeUsable) {
            if (!catalogEnabled) return aiService.generateReply(request);
            storeId = undefined; // degrade to catalog-only
        }
    }

    // Pipeline label used for cost attribution + Phase 6.5 diagnostic counters.
    // Catalog-only after possible store downgrade above → `catalog_tools`;
    // any flow with a usable store → `ecommerce_tools` (existing convention).
    const pipeline: AiPipeline = catalogEnabled && !storeId ? 'catalog_tools' : 'ecommerce_tools';
    const toolLoopModel = config.ai.model || DEFAULT_AI_MODEL;
    try {
        // Step 1: Call AI worker with tools enabled.
        // No recordAiAttempt/recordAiReturn at this hop — ai-worker
        // (ecommerceToolHandler.ts) is the canonical emit site. Hop-level
        // failure is tracked via recordAiFailedBeforeLog in the catch below.
        const toolResponse = await axios.post<AiWorkerToolResponse>(
            `${config.ai.serviceUrl}/generate-with-tools`,
            {
                comment: request.comment,
                language: request.language,
                context: {
                    ...request.context,
                    // Either flag enables the tool path on the worker. The
                    // worker picks tool sets based on each flag independently
                    // (catalog-only pages don't ship e-commerce tool defs).
                    ecommerceToolsEnabled: !!storeId,
                    catalogToolsEnabled: catalogEnabled,
                    pipeline,
                },
            },
            {
                timeout: TOOL_LOOP_TIMEOUT_MS,
                headers: request.context?.pageId ? { 'X-Workspace-Id': request.context.pageId } : undefined,
            },
        );

        const data = toolResponse.data;
        logToolRoundUsage(request, data, pipeline);
        let totalTokens = data.tokensUsed || 0;

        // No tool calls → AI handled it directly
        if (!data.toolCalls || data.toolCalls.length === 0) {
            return {
                reply: data.reply || '',
                language: data.language || request.language || 'en',
                cached: false,
                intent: data.intent,
                confidence: data.confidence,
                flags: data.flags,
                tokensUsed: totalTokens,
            };
        }

        // Tool loop: execute tool calls and send results back (max 2 rounds).
        // We accumulate tool results across rounds so the card builder can inspect
        // every successful product reference, not just the final round.
        let lastToolCalls = data.toolCalls;
        let lastToolResults: EcommerceToolResult[] = [];
        const allToolResults: EcommerceToolResult[] = [];

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            // Validate and filter tool calls
            const validToolCalls = lastToolCalls
                .filter(tc => VALID_TOOL_SET.has(tc.name))
                .slice(0, MAX_TOOL_CALLS_PER_ROUND);

            if (validToolCalls.length === 0) break;

            // Audit log — category reflects tool family so Sentry triage
            // can filter catalog vs e-commerce tool events.
            for (const tc of validToolCalls) {
                Sentry.addBreadcrumb({
                    category: CATALOG_TOOL_SET.has(tc.name) ? 'catalog-tool' : 'ecommerce-tool',
                    message: `Tool call: ${tc.name}`,
                    data: { storeId, pageId, round, tool: tc.name, args: tc.arguments },
                    level: 'info',
                });
            }

            // Execute tool calls — dispatcher routes catalog vs e-commerce names.
            lastToolResults = await Promise.all(
                validToolCalls.map((tc) => dispatchTool(tc, storeId, pageId)),
            );
            allToolResults.push(...lastToolResults);

            // Send results back to AI worker — same protocol: ai-worker
            // emits attempts/returns, backend tracks hop failures only.
            const finalResponse = await axios.post<AiWorkerToolResponse>(
                `${config.ai.serviceUrl}/generate-with-tool-results`,
                {
                    originalRequest: {
                        comment: request.comment,
                        language: request.language,
                        context: {
                            ...request.context,
                            ecommerceToolsEnabled: !!storeId,
                            catalogToolsEnabled: catalogEnabled,
                            pipeline,
                        },
                    },
                    toolResults: lastToolResults,
                    originalToolCalls: validToolCalls,
                },
                {
                    timeout: TOOL_LOOP_TIMEOUT_MS,
                    headers: request.context?.pageId ? { 'X-Workspace-Id': request.context.pageId } : undefined,
                },
            );

            const roundData = finalResponse.data;
            logToolRoundUsage(request, roundData, pipeline);
            totalTokens += roundData.tokensUsed || 0;

            // If AI returned more tool calls (Phase 2), loop again
            if (roundData.toolCalls && roundData.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS - 1) {
                lastToolCalls = roundData.toolCalls;
                continue;
            }

            // AI is still asking for tools at the final round (or returned an
            // empty reply). Throw rather than return an empty reply — sending a
            // blank DM mid-conversation is just as bad as a templated fallback.
            // The processor's outer catch treats this as transient via
            // `isTransientAiError`, so BullMQ retries — a single inference run
            // can get stuck; a fresh run may produce a final answer. After
            // retries exhaust, the row is flagged needs_attention.
            if (!roundData.reply) {
                throw new AiToolLoopExhaustedError(MAX_TOOL_ROUNDS);
            }

            // Final reply — attach product cards from any tool result that
            // referenced a product. Catalog-only flows have no storeId and
            // skip card building entirely (catalog items don't carry the
            // platform-specific product URLs the card builder expects).
            const productCards = storeId
                ? await buildProductCardsFromToolResults(storeId, allToolResults)
                : [];
            return {
                reply: roundData.reply,
                language: roundData.language || request.language || 'en',
                cached: false,
                intent: roundData.intent,
                confidence: roundData.confidence,
                flags: roundData.flags,
                tokensUsed: totalTokens,
                ...(productCards.length ? { productCards } : {}),
            };
        }

        // Loop broke out because the AI returned only invalid tool names that
        // were filtered out — no reply was ever produced. Same semantics as
        // the in-loop exhaustion: throw so retry / flag handle it.
        throw new AiToolLoopExhaustedError(MAX_TOOL_ROUNDS);
    } catch (error) {
        // `AiToolLoopExhaustedError` is part of the new contract — let it
        // propagate so the reply pipeline can retry / flag. Other errors
        // (tool execution failure, axios error from /generate-with-tools) keep
        // the existing graceful degradation: fall back to standard AI
        // generation (no tools).
        if (error instanceof AiToolLoopExhaustedError) {
            throw error;
        }
        // Hop-level failure (axios error, tool execution failure). Tag with
        // the same error_class as other hop failures so the breakdown script
        // can attribute the silent fallback to the right source.
        recordAiFailedBeforeLog(pipeline, toolLoopModel, 'AiWorkerUnreachable');
        captureError(error, 'E-commerce tool loop error', {
            tags: { service: 'ecommerce-tool-loop', storeId: storeId ?? 'none' },
        });

        // Graceful fallback: use standard AI generation (no tools)
        return aiService.generateReply(request);
    }
}
