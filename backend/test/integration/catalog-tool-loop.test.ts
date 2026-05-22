import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, createTestUser, createTestPage } from './setup';
import { catalogItems } from '../../src/db/schema';
import * as schema from '../../src/db/schema';

import './setup';

// We mock the axios call to the ai-worker so we can simulate the AI requesting
// a catalog tool and verify the backend tool-loop:
//   1. Routes the tool name to executeCatalogToolCall (not the e-commerce
//      executor — which would fail for catalog tools).
//   2. Sends the tool result back to the worker for the final reply.
//   3. Returns the worker's final reply unchanged.

const postMock = vi.fn();
vi.mock('axios', async () => {
    const actual = await vi.importActual<typeof import('axios')>('axios');
    return { ...actual, default: { ...actual.default, post: (...args: unknown[]) => postMock(...args) } };
});

// Bypass ai metrics / Sentry — irrelevant to this test
vi.mock('../../src/lib/aiMetrics', () => ({
    recordAiFailedBeforeLog: vi.fn(),
}));
vi.mock('../../src/services/aiUsageLog', () => ({
    logAiUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

describe('tool-loop catalog dispatch — Stage 2.3b', () => {
    let pageId: string;
    let courseId: string;

    beforeEach(async () => {
        postMock.mockReset();
        const user = await createTestUser();
        const page = await createTestPage(user.id);
        pageId = page.id;
        const [course] = await testDb.insert(catalogItems).values({
            pageId, type: 'course', name: 'IELTS Prep', description: 'Intensive prep',
            priceMinor: 250000, currency: 'SAR',
        }).returning();
        courseId = course.id;
    });

    it('dispatches catalog tool names to the catalog executor (not e-commerce)', async () => {
        // Round 1: worker asks for a catalog tool. Round 2: returns final reply.
        postMock
            .mockResolvedValueOnce({
                data: {
                    toolCalls: [{ name: 'search_entities', arguments: { query: 'IELTS' } }],
                    tokensUsed: 100, tokensIn: 80, tokensOut: 20,
                    model: 'gpt-4.1-mini',
                },
            })
            .mockResolvedValueOnce({
                data: {
                    reply: 'We offer IELTS Prep for 2500 SAR.',
                    language: 'en',
                    tokensUsed: 50, tokensIn: 40, tokensOut: 10,
                    model: 'gpt-4.1-mini',
                },
            });

        const { generateReplyWithTools } = await import('../../src/services/ecommerceToolLoop');
        const res = await generateReplyWithTools({
            comment: 'what english courses do you offer?',
            language: 'en',
            context: {
                userId: 'fake-user',
                pageId,
                catalogToolsEnabled: true,
                pipeline: 'catalog_tools',
            },
        });

        // Final reply propagated unchanged from worker
        expect(res.reply).toBe('We offer IELTS Prep for 2500 SAR.');
        expect(res.cached).toBe(false);

        // Two worker calls: /generate-with-tools then /generate-with-tool-results
        expect(postMock).toHaveBeenCalledTimes(2);
        const secondCallBody = postMock.mock.calls[1][1] as {
            toolResults: Array<{ tool_name: string; success: boolean; data?: { results: { id: string }[] } }>;
        };
        const [toolResult] = secondCallBody.toolResults;
        expect(toolResult.tool_name).toBe('search_entities');
        expect(toolResult.success).toBe(true);
        // The dispatcher hit our DB, not the e-commerce stub
        const ids = toolResult.data!.results.map(r => r.id);
        expect(ids).toContain(courseId);
    });

    it('degrades to catalog-only when store is inactive (regression for store-inactive bug)', async () => {
        // Setup: a store row, but mark it inactive. The loop must clear
        // storeId so the worker isn't told ecommerceToolsEnabled=true and the
        // LLM isn't offered e-commerce tools it can't actually use.
        const [store] = await testDb.insert(schema.ecommerceStores).values({
            userId: (await testDb.select({ id: schema.pages.userId })
                .from(schema.pages).where(eq(schema.pages.id, pageId)))[0].id!,
            platform: 'shopify',
            storeDomain: `inactive-${Date.now()}.myshopify.com`,
            accessToken: 'enc',
            accessTokenIv: 'iv',
            isActive: false,
        }).returning();

        postMock.mockResolvedValueOnce({
            data: {
                reply: 'Sure!', language: 'en',
                tokensUsed: 30, model: 'gpt-4.1-mini',
            },
        });

        const { generateReplyWithTools } = await import('../../src/services/ecommerceToolLoop');
        await generateReplyWithTools({
            comment: 'what courses?',
            language: 'en',
            context: {
                userId: 'fake-user',
                pageId,
                ecommerceStoreId: store.id,    // store EXISTS but is inactive
                catalogToolsEnabled: true,      // catalog IS available — must not bail out
            },
        });

        // The worker must be told ecommerceToolsEnabled=false because the
        // store is dead. catalog flag stays true. pipeline tag flips to
        // catalog_tools so cost is attributed correctly.
        expect(postMock).toHaveBeenCalledTimes(1);
        const ctxSent = (postMock.mock.calls[0][1] as { context: { ecommerceToolsEnabled: boolean; catalogToolsEnabled: boolean; pipeline: string } }).context;
        expect(ctxSent.ecommerceToolsEnabled).toBe(false);
        expect(ctxSent.catalogToolsEnabled).toBe(true);
        expect(ctxSent.pipeline).toBe('catalog_tools');
    });

    it('returns page_context_missing when a catalog tool is called without pageId', async () => {
        postMock
            .mockResolvedValueOnce({
                data: {
                    toolCalls: [{ name: 'list_active_entities', arguments: {} }],
                    tokensUsed: 50, model: 'gpt-4.1-mini',
                },
            })
            .mockResolvedValueOnce({
                data: { reply: 'Sorry, something went wrong.', tokensUsed: 10, model: 'gpt-4.1-mini' },
            });

        const { generateReplyWithTools } = await import('../../src/services/ecommerceToolLoop');
        await generateReplyWithTools({
            comment: 'what courses?',
            language: 'en',
            context: {
                userId: 'fake-user',
                // No pageId provided — dispatcher must surface a structured error
                catalogToolsEnabled: true,
            },
        });

        const secondCallBody = postMock.mock.calls[1][1] as {
            toolResults: Array<{ success: boolean; error?: string }>;
        };
        expect(secondCallBody.toolResults[0]).toMatchObject({ success: false, error: 'page_context_missing' });
    });

});

/**
 * dispatchAiReply probe-failure regression. The pre-flight DB probe
 * (pageHasCatalogItems) is wrapped in try/catch so a transient DB failure
 * never blocks reply generation — it just falls back to the no-tools path.
 * Without this guard, a single failing query would 500 every reply on every
 * page (catalog or not).
 */
describe('dispatchAiReply probe-failure fallback — Stage 2.3b safety net', () => {
    beforeEach(() => {
        vi.resetModules();
        postMock.mockReset();
    });

    it('falls back to no-tools path when pageHasCatalogItems throws', async () => {
        // Mock catalogTools to make the probe throw
        vi.doMock('../../src/services/catalogTools', () => ({
            pageHasCatalogItems: vi.fn().mockRejectedValue(new Error('DB unavailable')),
        }));

        // Capture aiService.generateReply to confirm fallback was hit
        const generateReplyMock = vi.fn().mockResolvedValue({
            reply: 'fallback reply', language: 'en', cached: false,
        });
        vi.doMock('../../src/services/ai', () => ({
            aiService: { generateReply: generateReplyMock },
        }));

        const { dispatchAiReply } = await import('../../src/services/reply/generator');
        const res = await dispatchAiReply({
            comment: 'hi',
            language: 'en',
            context: {
                userId: '00000000-0000-0000-0000-000000000001',
                pageId: '00000000-0000-0000-0000-000000000002',
                // No ecommerceStoreId — only the catalog probe runs
            },
        });

        expect(res.reply).toBe('fallback reply');
        expect(generateReplyMock).toHaveBeenCalledTimes(1);
        // No worker call: tool-loop was never entered
        expect(postMock).not.toHaveBeenCalled();

        vi.doUnmock('../../src/services/catalogTools');
        vi.doUnmock('../../src/services/ai');
    });
});
