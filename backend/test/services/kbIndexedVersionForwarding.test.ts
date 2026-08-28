/**
 * D-106 — `kbIndexedVersion` must reach the AI request context on EVERY path, because the
 * e-commerce tool loop reads it to decide whether the product resolver's page-index stage
 * runs (`resolveProduct`: `if (input.pageId && input.kbIndexedVersion)`).
 *
 * The failure this pins is a silent divergence, not a crash: the playground/eval path forwarded
 * the field into `resolveKnowledge` but omitted it from the request context it built, so the
 * resolver's semantic stage was OFF in the eval and ON for real customers — in the one surface
 * every reply-quality claim rests on (AI_INSTRUCTIONS §19.2). Both paths are asserted here
 * because a test on either alone cannot see a divergence between them.
 *
 * Mutation check: drop `kbIndexedVersion` from either context literal in generator.ts
 * (the DM one ~line 770, the playground one ~line 1033) → the matching test fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyGenerator } from '../../src/services/reply/generator';

// Inlined, not a shared const: vi.mock factories are hoisted above every top-level
// declaration, so referencing one from inside a factory throws at load.
vi.mock('../../src/services/ai', () => ({
    aiService: {
        generateReply: vi.fn().mockResolvedValue({
            reply: 'mocked', language: 'ar', cached: false,
            intent: 'QUESTION', confidence: 'high', flags: [],
        }),
    },
}));
vi.mock('../../src/services/ecommerceToolLoop', () => ({
    generateReplyWithTools: vi.fn().mockResolvedValue({
        reply: 'mocked', language: 'ar', cached: false,
        intent: 'QUESTION', confidence: 'high', flags: [],
    }),
}));
// No retrieval service → resolveKnowledge returns the static KB without a DB call, which is
// all this file needs: the subject is what lands in the request context, not what RAG returns.
vi.mock('../../src/services/kb/retrieval', () => ({
    getRetrievalService: () => null,
    ragRetrievalMode: () => 'dual',
    hasLiveProductChunks: vi.fn().mockResolvedValue(false),
}));
// Every member the generator actually calls — a partial stub here fails as
// "incrementAiReplies is not a function", which reads like a code bug and is not one.
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true }),
        incrementAiReplies: vi.fn().mockResolvedValue(undefined),
        logQuotaEvent: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getConversationHistory: vi.fn().mockResolvedValue([]),
        getCustomerSummary: vi.fn().mockResolvedValue(null),
    },
}));

import { generateReplyWithTools } from '../../src/services/ecommerceToolLoop';

const gen = new ReplyGenerator();

beforeEach(() => {
    vi.mocked(generateReplyWithTools).mockClear();
});

describe('D-106 — kbIndexedVersion reaches the AI request context', () => {
    it('production DM path forwards it to the tool loop', async () => {
        await gen.generateForMessage({
            workspaceId: 'ws-1', userId: 'u-1', pageId: 'page-1', senderId: 'sender-1',
            text: 'كم سعر الخلاط؟', knowledgeBase: 'kb',
            kbActiveVersion: 7, kbIndexedVersion: 4,
            ecommerceStoreId: 'store-1',
        } as never, true);

        expect(generateReplyWithTools).toHaveBeenCalledTimes(1);
        const ctx = vi.mocked(generateReplyWithTools).mock.calls[0]![0]!.context!;
        expect(ctx.kbActiveVersion).toBe(7);
        expect(ctx.kbIndexedVersion).toBe(4);
    });

    it('playground / eval path forwards the same field (no divergence from production)', async () => {
        await gen.generateForPlayground({
            pageId: 'page-1', userId: 'u-1', question: 'كم سعر الخلاط؟', channel: 'dm',
            knowledgeBase: 'kb', kbActiveVersion: 7, kbIndexedVersion: 4,
            ecommerceStoreId: 'store-1',
        } as never);

        expect(generateReplyWithTools).toHaveBeenCalledTimes(1);
        const ctx = vi.mocked(generateReplyWithTools).mock.calls[0]![0]!.context!;
        expect(ctx.kbActiveVersion).toBe(7);
        expect(ctx.kbIndexedVersion).toBe(4);
    });
});
