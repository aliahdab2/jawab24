/**
 * Unit coverage for ReplyGenerator.resolveKnowledge — the gate that decides whether a reply
 * is grounded in the FULL Business Info / KB or in RAG-retrieved chunks.
 *
 * Invariant (D-012): non-ecommerce pages ALWAYS receive the full KB and never have it
 * RAG-filtered, regardless of KB size. The KB is hard-capped at 16k chars so it always fits
 * the prompt; chunking it can only drop the answer-bearing text — the operational-fact
 * deflection (a short query like "وين موقعكم" retrieves the wrong chunks and the address,
 * which IS in the KB, never reaches the model). RAG is retained ONLY for ecommerce pages,
 * whose product specs/prices live in chunks, not in the static KB text.
 *
 * These tests are deterministic (no model calls): retrieval is mocked to ALWAYS return a
 * wrong chunk, so if the KB were ever RAG-filtered the wrong chunk would surface and the
 * assertions would fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// getRetrievalService() returns null unless RAG is "enabled" (ragMode != 'off' + an OpenAI
// key). Enable both so the retrieval service is reachable — then we prove the gate sends the
// full KB anyway (non-ecommerce), and only the ecommerce path actually consults retrieval.
// Set before any import so config (read at module load) picks them up.
vi.hoisted(() => {
    process.env.RAG_MODE = 'on';
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.KB_RAG_THRESHOLD_CHARS; // default lever = no ceiling → full KB at any size
    delete process.env.RAG_RETRIEVAL_MODE;     // default 'dual'
});

const WRONG_CHUNK = { type: 'info', title: 'unrelated', content: 'WRONG CHUNK — not the answer', finalScore: 0.42 };
const retrieve = vi.fn().mockResolvedValue({ chunks: [WRONG_CHUNK], queryEmbedding: [0.1, 0.2] });
const retrieveMulti = vi.fn().mockResolvedValue({ chunks: [WRONG_CHUNK], queryEmbedding: [0.1, 0.2] });

vi.mock('../services/kb/embedding', () => ({
    OpenAIEmbeddingProvider: vi.fn(() => ({})),
}));
// The lazy singleton lives in kb/retrieval since D-092, so the mock owns it too.
// (The factory is hoisted above the `const` mocks, so it must reach them lazily.)
vi.mock('../services/kb/retrieval', () => {
    const instance = () => ({
        setLogger: vi.fn(),
        retrieve: (...args: unknown[]) => retrieve(...args),
        retrieveMulti: (...args: unknown[]) => retrieveMulti(...args),
    });
    return {
        RetrievalService: vi.fn(instance),
        getRetrievalService: instance,
        ragRetrievalMode: () => 'dual',
    };
});

import { ReplyGenerator } from '../services/reply/generator';

type Resolved = { retrievedChunks?: unknown[]; effectiveKB?: string; ragAttempted: boolean };
const gen = new ReplyGenerator();
// resolveKnowledge is private; call it directly for a deterministic, model-free unit test.
const resolveKnowledge = (opts: Record<string, unknown>): Promise<Resolved> =>
    (gen as unknown as { resolveKnowledge: (o: unknown) => Promise<Resolved> }).resolveKnowledge({
        pageId: 'page-1', kbActiveVersion: 1, channel: 'dm', query: 'وين موقعكم', ...opts,
    });

const retrievalCalls = () => retrieve.mock.calls.length + retrieveMulti.mock.calls.length;

beforeEach(() => {
    retrieve.mockClear();
    retrieveMulti.mockClear();
});

describe('resolveKnowledge — non-ecommerce always gets the full KB (D-012)', () => {
    it('small non-ecommerce KB → full KB, no chunks, retrieval never consulted', async () => {
        const staticKB = 'ع'.repeat(2000);
        const r = await resolveKnowledge({ staticKB, hasEcommerceChunks: false });
        expect(r.effectiveKB).toBe(staticKB);
        expect(r.retrievedChunks).toBeUndefined();
        expect(r.ragAttempted).toBe(false);
        expect(retrievalCalls()).toBe(0);
    });

    it('large non-ecommerce KB (~12k, past the old 5k gate) → still full KB, no chunks, no cliff', async () => {
        const staticKB = 'ع'.repeat(12000);
        const r = await resolveKnowledge({ staticKB, hasEcommerceChunks: false });
        expect(r.effectiveKB).toBe(staticKB);
        expect(r.retrievedChunks).toBeUndefined();
        expect(r.ragAttempted).toBe(false);
        expect(retrievalCalls()).toBe(0);
    });

    it('oversized non-ecommerce KB (~30k) → full KB returned here, still no chunks (truncation is promptBuilder’s job)', async () => {
        const staticKB = 'ع'.repeat(30000);
        const r = await resolveKnowledge({ staticKB, hasEcommerceChunks: false });
        expect(r.effectiveKB).toBe(staticKB);
        expect(r.retrievedChunks).toBeUndefined();
        expect(r.ragAttempted).toBe(false);
        expect(retrievalCalls()).toBe(0);
    });

    it('ecommerce page → uses RAG chunks, KB omitted (ecommerce path intact)', async () => {
        const staticKB = 'ع'.repeat(12000);
        const r = await resolveKnowledge({ staticKB, hasEcommerceChunks: true });
        expect(r.ragAttempted).toBe(true);
        expect(retrievalCalls()).toBeGreaterThan(0);
        expect(r.retrievedChunks).toBeDefined();
        expect(r.effectiveKB).toBeUndefined();
    });

    it('emergency rollback lever: KB_RAG_THRESHOLD_CHARS set low re-enables RAG for larger KBs', async () => {
        process.env.KB_RAG_THRESHOLD_CHARS = '5000';
        try {
            const staticKB = 'ع'.repeat(12000); // > 5000 → legacy RAG path
            const r = await resolveKnowledge({ staticKB, hasEcommerceChunks: false });
            expect(r.ragAttempted).toBe(true);
            expect(retrievalCalls()).toBeGreaterThan(0);
        } finally {
            delete process.env.KB_RAG_THRESHOLD_CHARS;
        }
    });
});
