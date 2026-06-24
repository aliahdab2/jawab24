/**
 * Unit tests for kbFactExtractor.extract — free text → clean structured facts.
 *
 * Invariants under test:
 *  - parses {facts:[…]} and splits price out (for the price-confirm gate)
 *  - NEVER throws into callers: AI error / bad JSON / empty input all degrade to []
 *  - filters empty-content facts; caps pathological lengths
 *  - logs cost with pipeline='kb_fact_extraction' when a user is attributed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAiUsageMock, openaiCreateMock, captureErrorMock } = vi.hoisted(() => ({
    logAiUsageMock: vi.fn().mockResolvedValue(undefined),
    openaiCreateMock: vi.fn(),
    captureErrorMock: vi.fn(),
}));

vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        // makeTrackedOpenAI binds BOTH chat.completions.create and embeddings.create.
        chat: { completions: { create: openaiCreateMock } },
        embeddings: { create: vi.fn() },
    })),
    APIError: class APIError extends Error {},
    BadRequestError: class BadRequestError extends Error {},
    RateLimitError: class RateLimitError extends Error {},
}));
vi.mock('../../../src/config', () => ({ config: { openai: { apiKey: 'test-key' } } }));
vi.mock('../../../src/services/aiUsageLog', () => ({ logAiUsage: logAiUsageMock }));
vi.mock('../../../src/utils/sentryHelpers', () => ({ captureError: captureErrorMock }));
vi.mock('../../../src/services/aiModelResolver', () => ({
    getModelForUser: vi.fn().mockResolvedValue('gpt-4.1-mini'),
}));
vi.mock('../../../src/lib/aiMetrics', () => ({
    recordAiAttempt: vi.fn(), recordAiReturn: vi.fn(), recordAiFailedBeforeLog: vi.fn(),
}));

import { kbFactExtractor } from '../../../src/services/kb/factExtractor';

function aiReply(obj: unknown) {
    return {
        choices: [{ message: { content: JSON.stringify(obj) } }],
        // `model` must be present — the tracked client logs cost only when the response has usage AND model.
        model: 'gpt-4.1-mini',
        usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } },
    };
}

beforeEach(() => {
    openaiCreateMock.mockReset();
    logAiUsageMock.mockClear();
    captureErrorMock.mockClear();
});

describe('kbFactExtractor.extract', () => {
    it('parses facts and splits the price out', async () => {
        openaiCreateMock.mockResolvedValue(aiReply({ facts: [
            { title: 'دورة المكياج', content: 'دورة المكياج: التكلفة ٤٠ ألف، المدة شهر.', price: '٤٠ ألف' },
        ] }));
        const facts = await kbFactExtractor.extract('المكياج ٤٠ ألف شهر', { userId: 'u1', pageId: 'p1' });
        expect(facts).toHaveLength(1);
        expect(facts[0].title).toBe('دورة المكياج');
        expect(facts[0].content).toContain('٤٠');
        expect(facts[0].price).toBe('٤٠ ألف');
    });

    it('returns [] for empty/whitespace input without calling the AI', async () => {
        const facts = await kbFactExtractor.extract('   ', { userId: 'u1' });
        expect(facts).toEqual([]);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('degrades to [] (no throw) on an AI error, and reports it to Sentry', async () => {
        openaiCreateMock.mockRejectedValue(new Error('boom'));
        const facts = await kbFactExtractor.extract('some text', { userId: 'u1' });
        expect(facts).toEqual([]);
        expect(captureErrorMock).toHaveBeenCalled();
    });

    it('degrades to [] on unparseable JSON', async () => {
        openaiCreateMock.mockResolvedValue({ choices: [{ message: { content: 'not json{' } }], usage: null });
        const facts = await kbFactExtractor.extract('text', { userId: 'u1' });
        expect(facts).toEqual([]);
        expect(captureErrorMock).toHaveBeenCalled();
    });

    it('filters out facts with empty content', async () => {
        openaiCreateMock.mockResolvedValue(aiReply({ facts: [
            { title: 'x', content: '', price: '' },
            { title: 'العنوان', content: 'العنوان: برامكة.', price: '' },
        ] }));
        const facts = await kbFactExtractor.extract('t', { userId: 'u1' });
        expect(facts).toHaveLength(1);
        expect(facts[0].content).toContain('برامكة');
    });

    it('caps pathologically long content', async () => {
        const long = 'ا'.repeat(5000);
        openaiCreateMock.mockResolvedValue(aiReply({ facts: [{ title: 't', content: long, price: '' }] }));
        const facts = await kbFactExtractor.extract('t', { userId: 'u1' });
        expect(facts[0].content.length).toBeLessThanOrEqual(1000);
    });

    it('logs cost with the kb_fact_extraction pipeline when a user is attributed', async () => {
        openaiCreateMock.mockResolvedValue(aiReply({ facts: [{ title: 't', content: 'c', price: '' }] }));
        await kbFactExtractor.extract('t', { userId: 'u1', pageId: 'p1' });
        expect(logAiUsageMock).toHaveBeenCalledTimes(1);
        expect(logAiUsageMock.mock.calls[0][0]).toMatchObject({ pipeline: 'kb_fact_extraction', userId: 'u1' });
    });

    it('pins the model when ctx.model is provided (the backfill uses a stronger model)', async () => {
        openaiCreateMock.mockResolvedValue(aiReply({ facts: [{ title: 't', content: 'c', price: '' }] }));
        await kbFactExtractor.extract('t', { userId: 'u1', model: 'gpt-4.1' });
        expect(openaiCreateMock.mock.calls[0][0].model).toBe('gpt-4.1');
    });

    it('rejects a truncated (finish_reason=length) response → [] (cut-off JSON is unreliable)', async () => {
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: '{"facts":[{"title":"x"' }, finish_reason: 'length' }],
            model: 'gpt-4.1-mini', usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
        const facts = await kbFactExtractor.extract('text', { userId: 'u1' });
        expect(facts).toEqual([]);
    });
});

describe('kbFactExtractor.consolidate', () => {
    it('returns the input unchanged without calling the AI when there is ≤1 fact', async () => {
        const one = [{ title: 'a', content: 'a', price: '' }];
        const out = await kbFactExtractor.consolidate(one, { userId: 'u1' });
        expect(out).toEqual(one);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('returns the consolidated (merged) set the AI produces', async () => {
        openaiCreateMock.mockResolvedValue(aiReply({ facts: [
            { title: 'دورة الأمين - مبتدئ', content: 'مبتدئ 35000', price: '35000' },
        ] }));
        const input = [
            { title: 'الأمين مبتدئ', content: 'مبتدئ 35000', price: '35000' },
            { title: 'دورة الأمين للمحاسبة المستوى الأول', content: 'المستوى الأول 35000', price: '35000' },
        ];
        const out = await kbFactExtractor.consolidate(input, { userId: 'u1' });
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('دورة الأمين - مبتدئ');
    });

    it('NEVER loses facts: on an AI error it returns the input unchanged', async () => {
        openaiCreateMock.mockRejectedValue(new Error('boom'));
        const input = [
            { title: 'a', content: 'a', price: '' },
            { title: 'b', content: 'b', price: '' },
        ];
        const out = await kbFactExtractor.consolidate(input, { userId: 'u1' });
        expect(out).toEqual(input);
    });

    it('NEVER loses facts: on an empty AI result it keeps the input', async () => {
        openaiCreateMock.mockResolvedValue(aiReply({ facts: [] }));
        const input = [
            { title: 'a', content: 'a', price: '' },
            { title: 'b', content: 'b', price: '' },
        ];
        const out = await kbFactExtractor.consolidate(input, { userId: 'u1' });
        expect(out).toEqual(input);
    });
});
