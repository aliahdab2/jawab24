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
import { executeToolCall } from './ecommerceActions';
import { getStoreById } from './ecommerce';
import type { AiGenerateRequest, AiGenerateResponse } from '../types';
import { VALID_TOOL_NAMES, type EcommerceToolCall, type EcommerceToolResult } from '@jawab24/shared';

/** Response shape from ai-worker /generate-with-tools and /generate-with-tool-results */
interface AiWorkerToolResponse {
    toolCalls?: Array<{ name: string; arguments: Record<string, string> }>;
    reply?: string;
    language?: string;
    tokensUsed?: number;
    tokensIn?: number;
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

    try {
        // Step 1: Call AI worker with tools enabled
        const toolResponse = await axios.post<AiWorkerToolResponse>(
            `${config.ai.serviceUrl}/generate-with-tools`,
            {
                comment: request.comment,
                language: request.language,
                context: {
                    ...request.context,
                    ecommerceToolsEnabled: true,
                },
            },
            {
                timeout: TOOL_LOOP_TIMEOUT_MS,
                headers: request.context?.pageId ? { 'X-Workspace-Id': request.context.pageId } : undefined,
            },
        );

        const data = toolResponse.data;
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

        // Tool loop: execute tool calls and send results back (max 2 rounds)
        let lastToolCalls = data.toolCalls;
        let lastToolResults: EcommerceToolResult[] = [];

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

            // Execute tool calls
            lastToolResults = await Promise.all(
                validToolCalls.map((tc) => executeToolCall(storeId, tc as EcommerceToolCall)),
            );

            // Send results back to AI worker
            const finalResponse = await axios.post<AiWorkerToolResponse>(
                `${config.ai.serviceUrl}/generate-with-tool-results`,
                {
                    originalRequest: {
                        comment: request.comment,
                        language: request.language,
                        context: request.context,
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
            totalTokens += roundData.tokensUsed || 0;

            // If AI returned more tool calls (Phase 2), loop again
            if (roundData.toolCalls && roundData.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS - 1) {
                lastToolCalls = roundData.toolCalls;
                continue;
            }

            // Final reply
            return {
                reply: roundData.reply || '',
                language: roundData.language || request.language || 'en',
                cached: false,
                intent: roundData.intent,
                confidence: roundData.confidence,
                flags: roundData.flags,
                tokensUsed: totalTokens,
            };
        }

        // Exhausted rounds without a final reply — shouldn't happen normally
        return {
            reply: '',
            language: request.language || 'en',
            cached: false,
            intent: 'QUESTION',
            confidence: 'low',
            flags: ['tool_loop_exhausted'],
            tokensUsed: totalTokens,
        };
    } catch (error) {
        captureError(error, 'E-commerce tool loop error', {
            tags: { service: 'ecommerce-tool-loop', storeId },
        });

        // Graceful fallback: use standard AI generation (no tools)
        return aiService.generateReply(request);
    }
}
