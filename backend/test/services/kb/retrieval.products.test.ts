/**
 * retrieveProducts — the SQL shape the resolver depends on (D-092).
 *
 * Pins what a refactor could silently drop: the `type = 'product'` scan (no
 * HNSW pre-cut), the GROUP BY that makes a multi-chunk product ONE candidate,
 * the absence of the language/tier boosts, and the optional embedding.
 *
 * Mutation checks: drop GROUP BY → "one candidate per product" fails; add
 * `+ 0.02` language boost → "no boosts" fails; make the embedding required →
 * "without an embedding" fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
vi.mock('../../../src/db', () => ({ db: { execute: (...args: unknown[]) => mockExecute(...args) } }));
vi.mock('../../../src/config', () => ({ config: { ragMode: 'hybrid', openai: { apiKey: 'k' } } }));
vi.mock('../../../src/services/kb/embedding', () => ({ OpenAIEmbeddingProvider: vi.fn() }));

import { retrieveProducts } from '../../../src/services/kb/retrieval';

/** Flatten a drizzle `sql` tagged template into the text the DB would see (params as `?`). */
function sqlTextOf(call: unknown): string {
    const q = call as { queryChunks?: unknown[] };
    const walk = (chunks: unknown[]): string => chunks.map((c) => {
        if (typeof c === 'string') return c;
        const o = c as { value?: unknown; queryChunks?: unknown[] };
        if (o.queryChunks) return walk(o.queryChunks);
        if (Array.isArray(o.value)) return o.value.join('');
        if (o.value !== undefined) return '?';
        return '?';
    }).join('');
    return walk(q.queryChunks ?? []);
}

beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue([]);
});

describe('retrieveProducts', () => {
    it('scans product chunks of the page at the active version — exact, not HNSW top-20', async () => {
        await retrieveProducts('page-1', 5, 'نظارة', null);
        const text = sqlTextOf(mockExecute.mock.calls[0][0]);
        expect(text).toMatch(/type = 'product'/);
        expect(text).toMatch(/kb_version = \?/);
        expect(text).not.toMatch(/LIMIT 20\s*\)/);
    });

    it('returns ONE candidate per product (GROUP BY platformProductId, MAX of each score)', async () => {
        await retrieveProducts('page-1', 5, 'q', null);
        const text = sqlTextOf(mockExecute.mock.calls[0][0]);
        expect(text).toMatch(/GROUP BY platform_product_id/);
        expect(text).toMatch(/MAX\(vec_score\)/);
        expect(text).toMatch(/MAX\(tri_score\)/);
    });

    it('applies NO language or tier boost — product chunks are all one tier', async () => {
        await retrieveProducts('page-1', 5, 'q', [0.1, 0.2]);
        const text = sqlTextOf(mockExecute.mock.calls[0][0]);
        expect(text).not.toMatch(/language =/);
        expect(text).not.toMatch(/source_tier/);
    });

    it('cuts the candidates as the UNION of top-N by trigram and top-N by cosine — never one cut by the greater score', async () => {
        // One cut by GREATEST(vec, tri) drops a near-exact title (tri 0.33) as soon as
        // more than N products sit above it on cosine — every "related" product in a
        // single-category catalog does. The trigram stage then never sees it.
        await retrieveProducts('page-1', 5, 'q', [0.1, 0.2]);
        const text = sqlTextOf(mockExecute.mock.calls[0][0]);
        expect(text).toMatch(/\(SELECT \* FROM grouped ORDER BY tri_score DESC LIMIT \?\)/);
        expect(text).toMatch(/UNION \(SELECT \* FROM grouped ORDER BY vec_score DESC LIMIT \?\)/);
        expect(text).toMatch(/ORDER BY GREATEST\(COALESCE\(vec_score, 0\), tri_score\) DESC\s*$/);
    });

    it('without an embedding there is only the trigram cut — no cosine branch to union', async () => {
        await retrieveProducts('page-1', 5, 'q', null);
        const text = sqlTextOf(mockExecute.mock.calls[0][0]);
        expect(text).toMatch(/ORDER BY tri_score DESC LIMIT \?/);
        expect(text).not.toMatch(/UNION/);
    });

    it('works WITHOUT an embedding (trigram only) and reports vecScore as null', async () => {
        mockExecute.mockResolvedValue([{ platform_product_id: 'p1', title: 'T', vec_score: null, tri_score: '0.36' }]);
        const hits = await retrieveProducts('page-1', 5, 'q', null);
        const text = sqlTextOf(mockExecute.mock.calls[0][0]);
        expect(text).toMatch(/NULL::float8 AS vec_score/);
        expect(hits).toEqual([{ platformProductId: 'p1', title: 'T', vecScore: null, triScore: 0.36 }]);
    });

    it('uses the supplied embedding as the cosine operand when given', async () => {
        mockExecute.mockResolvedValue([{ platform_product_id: 'p1', title: 'T', vec_score: '0.532', tri_score: '0.01' }]);
        const hits = await retrieveProducts('page-1', 5, 'q', [0.1, 0.2]);
        const text = sqlTextOf(mockExecute.mock.calls[0][0]);
        // The flattener renders params inline; the operand is the vector literal cast to `vector`.
        expect(text).toMatch(/embedding <=> [^)]*::vector\)/);
        expect(hits[0]).toEqual({ platformProductId: 'p1', title: 'T', vecScore: 0.532, triScore: 0.01 });
    });
});
