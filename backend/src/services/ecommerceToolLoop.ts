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
 * - Every tool execution is counted at `metrics:ecom:tool:{name}:{outcome}`
 *   (ecommerceActions.ts). There is NO per-call audit row — an earlier version
 *   of this header claimed one that never existed.
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
import { aiWorkerHeaders } from './aiWorkerAuth';
import { logAiUsage } from './aiUsageLog';
import { recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { executeToolCall, type ToolExecutionContext } from './ecommerceActions';
import { getStoreById } from './ecommerce';
import { ragRetrievalMode } from './kb/retrieval';
import { buildProductCardsFromToolResults, buildProductCardsFromReplyText } from './reply/productCardBuilder';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';
import { AiToolLoopExhaustedError } from '../utils/fbGraphErrors';
import { noopLogger, type AiGenerateRequest, type AiGenerateResponse, type Logger } from '../types';
import { VALID_TOOL_NAMES, type EcommerceToolCall, type EcommerceToolResult } from '@jawab24/shared';

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

/** Shared whitelist converted to Set for O(1) lookup */
const VALID_TOOL_SET: Set<string> = new Set(VALID_TOOL_NAMES);

/** Fire-and-forget ai_usage_log write for one ai-worker tool-loop round. */
function logToolRoundUsage(request: AiGenerateRequest, data: AiWorkerToolResponse): void {
    const model = data.model || config.ai.model || DEFAULT_AI_MODEL;
    const userId = request.context?.userId;
    if (!userId) {
        // No userId → can't attribute. Surface as a breadcrumb so a future plumbing
        // regression is visible in Sentry instead of silently dropping rows.
        Sentry.addBreadcrumb({
            category: 'ai_usage_log',
            level: 'warning',
            message: 'ecommerce_tools usage skipped: no userId in context',
            data: { pageId: request.context?.pageId },
        });
        recordAiFailedBeforeLog('ecommerce_tools', model, 'MissingUserId');
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
            message: 'ecommerce_tools usage skipped: worker reported zero tokens',
            data: { pageId: request.context?.pageId, model: data.model },
        });
        recordAiFailedBeforeLog('ecommerce_tools', model, 'ZeroTokens');
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
        pipeline: 'ecommerce_tools',
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
    logger: Logger = noopLogger,
): Promise<AiGenerateResponse> {
    const storeId = request.context?.ecommerceStoreId;

    // No store connected → existing flow, untouched
    if (!storeId) {
        return aiService.generateReply(request);
    }

    // Verify the store exists and is active before entering the tool loop.
    // Ownership is guaranteed by the backend: ecommerceStoreId is set during
    // store linking (scoped to the workspace admin's page).
    try {
        const store = await getStoreById(storeId);
        if (!store || !store.isActive) {
            return aiService.generateReply(request);
        }
    } catch {
        return aiService.generateReply(request);
    }

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
                    ecommerceToolsEnabled: true,
                    pipeline: 'ecommerce_tools',
                },
            },
            {
                timeout: TOOL_LOOP_TIMEOUT_MS,
                headers: aiWorkerHeaders(request.context?.pageId ? { 'X-Workspace-Id': request.context.pageId } : undefined),
            },
        );

        const data = toolResponse.data;
        logToolRoundUsage(request, data);
        let totalTokens = data.tokensUsed || 0;

        // No tool calls → AI handled it directly. This is the COMMON path for a
        // small catalog (it is inlined in the prompt whole, so the model never
        // needs a tool) — and it used to return with no card at all. Attach a
        // card for the one product the reply names, if any.
        if (!data.toolCalls || data.toolCalls.length === 0) {
            const reply = data.reply || '';
            // The card follows the reply into the same thread, so it carries the
            // reply's OWN language — not the request hint, which may differ.
            const language = data.language || request.language || 'en';
            const productCards = await buildProductCardsFromReplyText(storeId, reply, language);
            return {
                reply,
                language,
                cached: false,
                intent: data.intent,
                confidence: data.confidence,
                flags: data.flags,
                tokensUsed: totalTokens,
                ...(productCards.length ? { productCards } : {}),
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

            // Audit log
            for (const tc of validToolCalls) {
                Sentry.addBreadcrumb({
                    category: 'ecommerce-tool',
                    message: `Tool call: ${tc.name}`,
                    data: { storeId, round, tool: tc.name, args: tc.arguments },
                    level: 'info',
                });
            }

            // Execute tool calls. The reply's own context rides along so the
            // product resolver can reuse its query embedding and scan the right
            // page index (D-092) instead of embedding again.
            // The embedding is reused ONLY when it is the customer's message's own
            // (`dual` / `off`): in `enriched` mode it embeds the message plus recent
            // history, and the resolver's thresholds were calibrated on the asked
            // phrase alone — so there the resolver embeds the phrase itself instead.
            const toolCtx: ToolExecutionContext = {
                pageId: request.context?.pageId,
                kbActiveVersion: request.context?.kbActiveVersion,
                queryEmbedding: ragRetrievalMode() === 'enriched' ? null : request.context?.queryEmbedding,
                userId: request.context?.userId,
                logger,
            };
            lastToolResults = await Promise.all(
                validToolCalls.map((tc) => executeToolCall(storeId, tc as EcommerceToolCall, toolCtx)),
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
                        context: { ...request.context, pipeline: 'ecommerce_tools' },
                    },
                    toolResults: lastToolResults,
                    originalToolCalls: validToolCalls,
                },
                {
                    timeout: TOOL_LOOP_TIMEOUT_MS,
                    headers: aiWorkerHeaders(request.context?.pageId ? { 'X-Workspace-Id': request.context.pageId } : undefined),
                },
            );

            const roundData = finalResponse.data;
            logToolRoundUsage(request, roundData);
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
            // referenced a product. When no tool carried product data (e.g. only
            // lookup_order ran), fall back to the one product the reply names.
            const language = roundData.language || request.language || 'en';
            const toolCards = await buildProductCardsFromToolResults(storeId, allToolResults, language);
            const productCards = toolCards.length
                ? toolCards
                : await buildProductCardsFromReplyText(storeId, roundData.reply, language);
            return {
                reply: roundData.reply,
                language,
                cached: false,
                intent: roundData.intent,
                confidence: roundData.confidence,
                flags: roundData.flags,
                tokensUsed: totalTokens,
                ...(productCards.length ? { productCards } : {}),
                // What each tool DECIDED, for the eval to assert on (Rule 19):
                // present only when a tool round ran, omitted on the no-tool path.
                toolOutcomes: allToolResults.map(r => ({
                    name: r.tool_name,
                    outcome: r.success ? 'success' : (r.error ?? 'unknown'),
                    ...(typeof r.data?.platformProductId === 'string' ? { platformProductId: r.data.platformProductId } : {}),
                    ...(r.candidates?.length ? { candidateIds: r.candidates.map(c => c.platformProductId) } : {}),
                })),
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
        recordAiFailedBeforeLog('ecommerce_tools', toolLoopModel, 'AiWorkerUnreachable');
        captureError(error, 'E-commerce tool loop error', {
            tags: { service: 'ecommerce-tool-loop', storeId },
        });

        // Graceful fallback: use standard AI generation (no tools)
        return aiService.generateReply(request);
    }
}
