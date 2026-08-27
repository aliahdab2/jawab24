/**
 * Tests for E-Commerce Tool Loop Orchestrator
 *
 * Covers:
 * - Delegation to aiService when no store connected
 * - Store ownership check / graceful fallback
 * - Tool call round limits
 * - Graceful fallback on errors
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockAiServiceGenerateReply = vi.fn();
// Mock aiUsageLog so the cost-logging side-effect doesn't pull in redis at module load.
vi.mock('../../src/services/aiUsageLog', () => ({
    logAiUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/ai', () => ({
    aiService: {
        generateReply: (...args: unknown[]) => mockAiServiceGenerateReply(...args),
    },
}));

const mockExecuteToolCall = vi.fn();
vi.mock('../../src/services/ecommerceActions', () => ({
    executeToolCall: (...args: unknown[]) => mockExecuteToolCall(...args),
}));

const mockGetStoreById = vi.fn();
vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
}));

// Which embedding the reply carries (D-092): the resolver may reuse it only when it
// is the message's own (`dual` / `off`), never an enriched, history-laden one.
const mockRagRetrievalMode = vi.fn<() => 'off' | 'enriched' | 'dual'>(() => 'dual');
vi.mock('../../src/services/kb/retrieval', () => ({
    ragRetrievalMode: () => mockRagRetrievalMode(),
}));

// Card builders are unit-tested on their own (productCardBuilder*.test.ts);
// here we only pin WHEN the loop asks for which kind of card.
const mockCardsFromTools = vi.fn();
const mockCardsFromText = vi.fn();
const mockCardsFromIds = vi.fn();
vi.mock('../../src/services/reply/productCardBuilder', () => ({
    buildProductCardsFromToolResults: (...args: unknown[]) => mockCardsFromTools(...args),
    buildProductCardsFromReplyText: (...args: unknown[]) => mockCardsFromText(...args),
    buildProductCardsFromIds: (...args: unknown[]) => mockCardsFromIds(...args),
}));

const mockAxiosPost = vi.fn();
vi.mock('axios', () => ({
    default: {
        post: (...args: unknown[]) => mockAxiosPost(...args),
    },
}));

vi.mock('@sentry/node', () => ({
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
}));

vi.mock('../../src/config', () => ({
    config: {
        ai: { serviceUrl: 'http://localhost:3002' },
        // lib/redis reads this at module import (aiMetrics → lib/redis transitively).
        redis: { host: 'localhost', port: 6379 },
    },
}));

import { generateReplyWithTools } from '../../src/services/ecommerceToolLoop';
import type { AiGenerateRequest } from '../../src/types';

beforeEach(() => {
    vi.clearAllMocks();
    mockCardsFromTools.mockResolvedValue([]);
    mockCardsFromText.mockResolvedValue([]);
    mockCardsFromIds.mockResolvedValue([]);
    mockAiServiceGenerateReply.mockResolvedValue({
        reply: 'fallback reply',
        language: 'en',
        cached: false,
    });
});

const baseRequest: AiGenerateRequest = {
    comment: 'where is my order 1234?',
    language: 'ar',
    context: {},
};

describe('generateReplyWithTools', () => {
    it('delegates to aiService when no ecommerceStoreId', async () => {
        const result = await generateReplyWithTools(baseRequest);
        expect(mockAiServiceGenerateReply).toHaveBeenCalledWith(baseRequest);
        expect(result.reply).toBe('fallback reply');
    });

    it('delegates to aiService when store is inactive', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: false });
        const request = { ...baseRequest, context: { ecommerceStoreId: 'store-1' } };

        const result = await generateReplyWithTools(request);
        expect(mockAiServiceGenerateReply).toHaveBeenCalled();
        expect(result.reply).toBe('fallback reply');
    });

    it('delegates to aiService when store lookup throws', async () => {
        mockGetStoreById.mockRejectedValue(new Error('DB down'));
        const request = { ...baseRequest, context: { ecommerceStoreId: 'store-1' } };

        await generateReplyWithTools(request);
        expect(mockAiServiceGenerateReply).toHaveBeenCalled();
    });

    it('returns direct reply when AI does not call tools', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });
        mockAxiosPost.mockResolvedValue({
            data: {
                reply: 'direct answer',
                language: 'ar',
                intent: 'QUESTION',
                confidence: 'high',
                tokensUsed: 100,
            },
        });

        const request = { ...baseRequest, context: { ecommerceStoreId: 'store-1' } };
        const result = await generateReplyWithTools(request);
        expect(result.reply).toBe('direct answer');
        expect(result.intent).toBe('QUESTION');
    });

    // The common small-catalog path: the model answers from the inlined
    // catalog and never calls a tool. This branch returned with no card at
    // all — live on the Zid dev store the purchase turn got a bare URL.
    it('attaches a mention card on the direct-reply path (no tool calls)', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'zid' });
        mockAxiosPost.mockResolvedValue({
            data: { reply: 'تقدر تطلب كاميرا Sony A7S III من متجرنا', language: 'ar', tokensUsed: 50 },
        });
        const card = { title: 'Sony A7S III', subtitle: '10000 SAR · In stock', imageUrl: 'i', productUrl: 'u' };
        mockCardsFromText.mockResolvedValue([card]);

        const result = await generateReplyWithTools({ ...baseRequest, context: { ecommerceStoreId: 'store-1' } });

        expect(mockCardsFromText).toHaveBeenCalledWith('store-1', 'تقدر تطلب كاميرا Sony A7S III من متجرنا', 'ar');
        expect(result.productCards).toEqual([card]);
        expect(mockCardsFromTools).not.toHaveBeenCalled();
    });

    // D-099: the model names the products it presents (`respond.product_ids`).
    // Those cards come FIRST — nothing is inferred from the prose when the reply
    // names products; the text builder is the fallback for a reply that names none.
    it('cards the products the model NAMED by id, ahead of reading the prose (direct-reply path)', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'salla' });
        mockAxiosPost.mockResolvedValue({
            data: { reply: 'هذي التنورة 👇', language: 'ar', productIds: ['812874023'], tokensUsed: 50 },
        });
        const named = { title: 'تنورة', subtitle: '79 SAR', imageUrl: 'i', productUrl: 'u' };
        mockCardsFromIds.mockResolvedValue([named]);

        const result = await generateReplyWithTools({ ...baseRequest, context: { ecommerceStoreId: 'store-1' } });

        expect(mockCardsFromIds).toHaveBeenCalledWith('store-1', ['812874023'], 'ar');
        expect(result.productCards).toEqual([named]);
        expect(mockCardsFromText).not.toHaveBeenCalled();
    });

    it('falls back to the prose when every named id resolved to no card (unknown / sold out)', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'salla' });
        mockAxiosPost.mockResolvedValue({
            data: { reply: 'تقدر تطلب كاميرا Sony A7S III من متجرنا', language: 'ar', productIds: ['nope'], tokensUsed: 50 },
        });
        mockCardsFromIds.mockResolvedValue([]);
        const mention = { title: 'Sony A7S III', subtitle: 's', imageUrl: 'i', productUrl: 'u' };
        mockCardsFromText.mockResolvedValue([mention]);

        const result = await generateReplyWithTools({ ...baseRequest, context: { ecommerceStoreId: 'store-1' } });

        expect(result.productCards).toEqual([mention]);
    });

    it('on the tool path, model-named ids win over the tool-result card', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'zid' });
        mockAxiosPost
            .mockResolvedValueOnce({ data: { toolCalls: [{ name: 'check_inventory', arguments: { product_name: 'Sony' } }], tokensUsed: 10 } })
            .mockResolvedValueOnce({ data: { reply: 'Sony A7S III متوفرة', language: 'ar', productIds: ['sony-1'], tokensUsed: 20 } });
        mockExecuteToolCall.mockResolvedValue({ tool_name: 'check_inventory', success: true, data: { productName: 'Sony A7S III', available: true } });
        const named = { title: 'Sony A7S III', subtitle: 'named', imageUrl: 'i', productUrl: 'u' };
        mockCardsFromIds.mockResolvedValue([named]);

        const result = await generateReplyWithTools({ ...baseRequest, context: { ecommerceStoreId: 'store-1' } });

        expect(mockCardsFromIds).toHaveBeenCalledWith('store-1', ['sony-1'], 'ar');
        expect(result.productCards).toEqual([named]);
        expect(mockCardsFromTools).not.toHaveBeenCalled();
    });

    it('omits productCards entirely (not an empty array) when the reply names no product', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'zid' });
        mockAxiosPost.mockResolvedValue({ data: { reply: 'ما عندي معلومة', language: 'ar', tokensUsed: 50 } });

        const result = await generateReplyWithTools({ ...baseRequest, context: { ecommerceStoreId: 'store-1' } });

        expect('productCards' in result).toBe(false);
    });

    it('on the tool path, falls back to a mention card ONLY when no tool result produced one', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'zid' });
        mockAxiosPost
            .mockResolvedValueOnce({ data: { toolCalls: [{ name: 'lookup_order', arguments: { order_number: '1' } }], tokensUsed: 10 } })
            .mockResolvedValueOnce({ data: { reply: 'طلبك يحتوي Sony A7S III', language: 'ar', tokensUsed: 20 } });
        mockExecuteToolCall.mockResolvedValue({ tool_name: 'lookup_order', success: true, data: {} });
        const mention = { title: 'Sony A7S III', subtitle: 's', imageUrl: 'i', productUrl: 'u' };
        mockCardsFromText.mockResolvedValue([mention]);

        const result = await generateReplyWithTools({ ...baseRequest, context: { ecommerceStoreId: 'store-1' } });

        expect(mockCardsFromTools).toHaveBeenCalled();
        expect(mockCardsFromText).toHaveBeenCalledWith('store-1', 'طلبك يحتوي Sony A7S III', 'ar');
        expect(result.productCards).toEqual([mention]);
    });

    it('on the tool path, a tool-result card wins and the mention builder is not consulted', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'zid' });
        mockAxiosPost
            .mockResolvedValueOnce({ data: { toolCalls: [{ name: 'check_inventory', arguments: { product_name: 'Sony' } }], tokensUsed: 10 } })
            .mockResolvedValueOnce({ data: { reply: 'Sony A7S III متوفرة', language: 'ar', tokensUsed: 20 } });
        mockExecuteToolCall.mockResolvedValue({ tool_name: 'check_inventory', success: true, data: { productName: 'Sony A7S III', available: true } });
        const toolCard = { title: 'Sony A7S III', subtitle: 'from tool', imageUrl: 'i', productUrl: 'u' };
        mockCardsFromTools.mockResolvedValue([toolCard]);

        const result = await generateReplyWithTools({ ...baseRequest, context: { ecommerceStoreId: 'store-1' } });

        expect(result.productCards).toEqual([toolCard]);
        expect(mockCardsFromText).not.toHaveBeenCalled();
    });

    it('executes tool calls and returns final reply', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });

        // First call: AI returns tool calls
        mockAxiosPost.mockResolvedValueOnce({
            data: {
                toolCalls: [{ name: 'lookup_order', arguments: { order_number: '1234' } }],
                tokensUsed: 50,
            },
        });

        // Tool execution returns verification challenge
        mockExecuteToolCall.mockResolvedValueOnce({
            tool_name: 'lookup_order',
            success: true,
            data: { orderFound: true, orderNumber: '1234', message: 'Verify identity' },
        });

        // Second call: AI returns final reply
        mockAxiosPost.mockResolvedValueOnce({
            data: {
                reply: 'I found your order. Can you tell me your name?',
                language: 'ar',
                intent: 'QUESTION',
                confidence: 'high',
                tokensUsed: 80,
            },
        });

        const request = { ...baseRequest, context: { ecommerceStoreId: 'store-1' } };
        const result = await generateReplyWithTools(request);

        // Third argument: the reply context the resolver reuses (D-092).
        expect(mockExecuteToolCall).toHaveBeenCalledWith('store-1', expect.objectContaining({ name: 'lookup_order' }), expect.any(Object));
        expect(result.reply).toContain('found your order');
    });

    /** One tool round: the AI asks for check_inventory, the tool answers, the AI replies. */
    function primeOneInventoryRound() {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'zid' });
        mockAxiosPost
            .mockResolvedValueOnce({ data: { toolCalls: [{ name: 'check_inventory', arguments: { product_name: 'نظارة' } }], tokensUsed: 50 } })
            .mockResolvedValueOnce({ data: { reply: 'متوفرة', language: 'ar', intent: 'QUESTION', confidence: 'high', tokensUsed: 80 } });
        mockExecuteToolCall.mockResolvedValueOnce({ tool_name: 'check_inventory', success: true, data: { platformProductId: 'p1', available: true } });
    }

    it('hands the resolver the reply context — the message\'s own embedding in dual mode — and the request logger', async () => {
        primeOneInventoryRound();
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
        const request = {
            ...baseRequest,
            context: { ecommerceStoreId: 'store-1', pageId: 'page-1', kbIndexedVersion: 3, queryEmbedding: [0.1, 0.2], userId: 'user-1' },
        };

        await generateReplyWithTools(request, logger);

        expect(mockExecuteToolCall).toHaveBeenCalledWith('store-1', expect.objectContaining({ name: 'check_inventory' }), {
            pageId: 'page-1', kbIndexedVersion: 3, queryEmbedding: [0.1, 0.2], userId: 'user-1', logger,
        });
    });

    it('withholds an ENRICHED embedding — the resolver was calibrated on the asked phrase, not on recent history', async () => {
        mockRagRetrievalMode.mockReturnValue('enriched');
        primeOneInventoryRound();
        const request = { ...baseRequest, context: { ecommerceStoreId: 'store-1', pageId: 'page-1', kbIndexedVersion: 3, queryEmbedding: [0.1, 0.2] } };

        await generateReplyWithTools(request);

        expect(mockExecuteToolCall).toHaveBeenCalledWith('store-1', expect.anything(), expect.objectContaining({ queryEmbedding: null, pageId: 'page-1' }));
    });

    it('falls back to aiService on tool loop error', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });
        mockAxiosPost.mockRejectedValue(new Error('timeout'));

        const request = { ...baseRequest, context: { ecommerceStoreId: 'store-1' } };
        const result = await generateReplyWithTools(request);

        // Should gracefully fall back
        expect(mockAiServiceGenerateReply).toHaveBeenCalled();
        expect(result.reply).toBe('fallback reply');
    });

    it('an EMPTY Phase-2 reply (typed AiEmptyReplyError on the wire) propagates — never regenerated without the tool data (D-097)', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'salla' });
        // Round 1: the model asks for a tool. Round 2: the ai-worker answered but the
        // reply was empty → its route serialises the typed error as a 500 body.
        mockAxiosPost
            .mockResolvedValueOnce({ data: { toolCalls: [{ name: 'verify_and_get_order', arguments: { order_number: '1234', provided_name: 'Sara' } }], tokensUsed: 50 } })
            .mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 500'), {
                response: { status: 500, data: { error: { name: 'AiEmptyReplyError', message: 'empty' } } },
            }));
        mockExecuteToolCall.mockResolvedValue({ tool_name: 'verify_and_get_order', success: true, data: { order_number: '1234', status: 'shipped' } });

        const { AiEmptyReplyError } = await import('../../src/utils/fbGraphErrors');
        const request = { ...baseRequest, context: { ecommerceStoreId: 'store-1' } };

        await expect(generateReplyWithTools(request)).rejects.toBeInstanceOf(AiEmptyReplyError);
        // The verified order data only existed in the failed call's context — a
        // plain regeneration could not answer, so it must not be attempted.
        expect(mockAiServiceGenerateReply).not.toHaveBeenCalled();
    });

    it('any OTHER typed error on the tool-results hop keeps the pre-existing graceful fallback', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'salla' });
        mockAxiosPost
            .mockResolvedValueOnce({ data: { toolCalls: [{ name: 'lookup_order', arguments: { order_number: '1234' } }], tokensUsed: 50 } })
            .mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 500'), {
                response: { status: 500, data: { error: { name: 'AiTimeoutError', message: 'timeout' } } },
            }));
        mockExecuteToolCall.mockResolvedValue({ tool_name: 'lookup_order', success: true, data: { orderFound: true } });

        const request = { ...baseRequest, context: { ecommerceStoreId: 'store-1' } };
        const result = await generateReplyWithTools(request);
        expect(mockAiServiceGenerateReply).toHaveBeenCalled();
        expect(result.reply).toBe('fallback reply');
    });

    it('filters out invalid tool names from AI response', async () => {
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });

        mockAxiosPost.mockResolvedValueOnce({
            data: {
                toolCalls: [
                    { name: 'evil_tool', arguments: {} },
                    { name: 'lookup_order', arguments: { order_number: '1234' } },
                ],
                tokensUsed: 50,
            },
        });

        mockExecuteToolCall.mockResolvedValueOnce({
            tool_name: 'lookup_order',
            success: true,
            data: { orderFound: true, orderNumber: '1234' },
        });

        mockAxiosPost.mockResolvedValueOnce({
            data: { reply: 'done', language: 'en', tokensUsed: 30 },
        });

        const request = { ...baseRequest, context: { ecommerceStoreId: 'store-1' } };
        await generateReplyWithTools(request);

        // Only the valid tool should be executed
        expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
        // Third argument: the reply context the resolver reuses (D-092).
        expect(mockExecuteToolCall).toHaveBeenCalledWith('store-1', expect.objectContaining({ name: 'lookup_order' }), expect.any(Object));
    });

    it('throws AiToolLoopExhaustedError when the AI keeps requesting tools past MAX_TOOL_ROUNDS', async () => {
        // Previously this returned `reply: ''` with flag `tool_loop_exhausted`,
        // which downstream would either send a blank DM or fail at the FB API.
        // New contract: throw a typed error classified as transient so the reply
        // pipeline retries (a fresh inference run may produce a final reply) and
        // ultimately flags the row on retry exhaustion.
        mockGetStoreById.mockResolvedValue({ isActive: true, platform: 'shopify' });

        // Both rounds keep requesting tool calls — never returns a final reply.
        mockAxiosPost.mockResolvedValue({
            data: {
                toolCalls: [{ name: 'lookup_order', arguments: { order_number: '1234' } }],
                tokensUsed: 50,
            },
        });
        mockExecuteToolCall.mockResolvedValue({
            tool_name: 'lookup_order',
            success: true,
            data: { orderFound: true, orderNumber: '1234' },
        });

        const { AiToolLoopExhaustedError } = await import('../../src/utils/fbGraphErrors');
        const request = { ...baseRequest, context: { ecommerceStoreId: 'store-1' } };

        await expect(generateReplyWithTools(request)).rejects.toBeInstanceOf(
            AiToolLoopExhaustedError,
        );
    });
});
