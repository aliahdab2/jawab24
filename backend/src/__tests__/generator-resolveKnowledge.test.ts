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
// Real product-chunk probe (D-106) hits the DB; these tests are DB-free, so it answers from
// the case's own `hasEcommerceChunks` intent. Overridden per-test where the gate is the subject.
const hasLiveProductChunks = vi.fn().mockResolvedValue(true);

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
        // Required: resolveKnowledge calls this to decide whether the page has product
        // chunks to retrieve (D-106). Omit it and the gate's `await` resolves undefined —
        // the mock, not the code, would decide the verdict.
        hasLiveProductChunks: (...args: unknown[]) => hasLiveProductChunks(...args),
    };
});

import { ReplyGenerator } from '../services/reply/generator';

type Resolved = { retrievedChunks?: unknown[]; effectiveKB?: string; ragAttempted: boolean };
const gen = new ReplyGenerator();
// resolveKnowledge is private; call it directly for a deterministic, model-free unit test.
const resolveKnowledge = (opts: Record<string, unknown>): Promise<Resolved> =>
    (gen as unknown as { resolveKnowledge: (o: unknown) => Promise<Resolved> }).resolveKnowledge({
        pageId: 'page-1', kbActiveVersion: 1, kbIndexedVersion: 1,
        channel: 'dm', query: 'وين موقعكم', ...opts,
    });

const retrievalCalls = () => retrieve.mock.calls.length + retrieveMulti.mock.calls.length;

beforeEach(() => {
    retrieve.mockClear();
    retrieveMulti.mockClear();
    hasLiveProductChunks.mockClear();
    hasLiveProductChunks.mockResolvedValue(true);
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

    // ---- D-106: the live-index pointer and the probe that reads it ----------------

    it('no live chunk generation (kbIndexedVersion null) → full KB, no retrieval call, ragAttempted TRUE', async () => {
        const staticKB = 'ع'.repeat(3000);
        const r = await resolveKnowledge({ staticKB, hasEcommerceChunks: true, kbIndexedVersion: null });
        expect(r.effectiveKB).toBe(staticKB);
        expect(retrievalCalls()).toBe(0);
        // TRUE on purpose: before the split this state ran retrieval and got 0 rows, and
        // computeReplyFlags keys its hallucination backstop on (ragAttempted && 0 chunks &&
        // no static KB). Reporting false would disarm it for an empty-KB page.
        expect(r.ragAttempted).toBe(true);
    });

    it('never-versioned page (kbActiveVersion null) → ragAttempted FALSE, as before the split', async () => {
        const staticKB = 'ع'.repeat(3000);
        const r = await resolveKnowledge({ staticKB, hasEcommerceChunks: true, kbActiveVersion: null });
        expect(r.effectiveKB).toBe(staticKB);
        expect(retrievalCalls()).toBe(0);
        expect(r.ragAttempted).toBe(false);
    });

    it('product-chunk probe THROWS → falls back to the full KB instead of aborting the reply', async () => {
        // The probe is the only thing in this gate that can throw, and it sits above the
        // try/catch that exists to degrade RAG failures to the static KB. Neither
        // generateForComment nor generateForMessage wraps resolveKnowledge, so an escaping
        // pool timeout would turn "reply grounded in the full KB" into NO REPLY on every
        // page carrying a catalog block.
        hasLiveProductChunks.mockRejectedValue(new Error('connection terminated'));
        const staticKB = 'ع'.repeat(3000);
        const r = await resolveKnowledge({ staticKB, hasEcommerceChunks: true });
        expect(r.effectiveKB).toBe(staticKB);
        expect(r.retrievedChunks).toBeUndefined();
        expect(retrievalCalls()).toBe(0);
    });

    it('page with a catalog block but NO product chunks → full KB, retrieval never consulted', async () => {
        // One merchant-typed catalog row used to be enough to put a page on semantic search
        // with nothing to search (D-004: those rows are prompt-injected, never chunked).
        hasLiveProductChunks.mockResolvedValue(false);
        const staticKB = 'ع'.repeat(10000);
        const r = await resolveKnowledge({ staticKB, hasEcommerceChunks: true });
        expect(r.effectiveKB).toBe(staticKB);
        expect(retrievalCalls()).toBe(0);
    });

    it('retrieval filters on the INDEXED pointer, not the cache token', async () => {
        const r = await resolveKnowledge({ staticKB: 'kb', hasEcommerceChunks: true, kbActiveVersion: 54, kbIndexedVersion: 51 });
        expect(retrievalCalls()).toBeGreaterThan(0);
        const calls = retrieveMulti.mock.calls.length ? retrieveMulti.mock.calls : retrieve.mock.calls;
        const versionArg = calls[0]?.[2];
        expect(versionArg).toBe(51);
        expect(r.retrievedChunks?.length).toBeGreaterThan(0);
    });
});
