/**
 * Validation/canonicalization behavior of the operational-facts extractor.
 * The LLM call is mocked at the openaiClient boundary; these tests assert that
 * whatever the model returns is hard-validated before it can become an
 * authoritative business_profile fact (a wrong structured fact is worse than
 * an absent one).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { openaiCreateMock } = vi.hoisted(() => ({ openaiCreateMock: vi.fn() }));

vi.mock('../../../src/services/openaiClient', () => ({
    makeTrackedOpenAI: () => ({ chat: { completions: { create: openaiCreateMock } } }),
}));
vi.mock('../../../src/services/aiModelResolver', () => ({
    getModelForUser: vi.fn().mockResolvedValue('gpt-4.1-mini'),
}));
vi.mock('../../../src/config', () => ({ config: { openai: { apiKey: 'test-key' } } }));

import { operationalFactsExtractor } from '../../../src/services/kb/operationalFactsExtractor';

function mockReply(obj: unknown, finishReason = 'stop') {
    openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: finishReason }],
    });
}

const CTX = { userId: 'user-1', pageId: 'page-1' };

describe('operationalFactsExtractor', () => {
    beforeEach(() => vi.clearAllMocks());

    it('canonicalizes the institute case (every day 9–8 except Friday closed)', async () => {
        mockReply({
            hours: {
                sat: '9am-8pm', sun: '9am-8pm', mon: '9am-8pm',
                tue: '9am-8pm', wed: '9am-8pm', thu: '9am-8pm', fri: 'closed',
            },
            address: 'برامكة سانا فوق مكتبة الحافظ الطابق الاول مدينة دمشق',
            phones: ['0935924472'],
        });

        const facts = await operationalFactsExtractor.extract('… KB text …', CTX);

        expect(facts.hours).toEqual({
            sat: ['09:00-20:00'], sun: ['09:00-20:00'], mon: ['09:00-20:00'],
            tue: ['09:00-20:00'], wed: ['09:00-20:00'], thu: ['09:00-20:00'],
            fri: ['closed'],
        });
        expect(facts.address).toBe('برامكة سانا فوق مكتبة الحافظ الطابق الاول مدينة دمشق');
        expect(facts.phones).toEqual(['0935924472']);
    });

    it('drops invalid day keys and unparseable hour values, keeps the valid ones', async () => {
        mockReply({ hours: { fri: 'closed', funday: '9-5', sat: '25:00' }, address: '', phones: [] });

        const facts = await operationalFactsExtractor.extract('x', CTX);

        expect(facts.hours).toEqual({ fri: ['closed'] }); // funday (bad key) + sat (bad time) dropped
        expect(facts.address).toBeUndefined(); // empty string → omitted
        expect(facts.phones).toBeUndefined();
    });

    it('filters phones lacking digits and dedupes', async () => {
        mockReply({ hours: {}, address: '  ', phones: ['abc', '0935924472', '12', '0935924472'] });

        const facts = await operationalFactsExtractor.extract('x', CTX);

        expect(facts.phones).toEqual(['0935924472']); // 'abc' (no digits), '12' (<3 digits), dup removed
        expect(facts.hours).toBeUndefined(); // empty object → omitted
        expect(facts.address).toBeUndefined();
    });

    it('returns {} on empty input without calling the model', async () => {
        const facts = await operationalFactsExtractor.extract('   ', CTX);
        expect(facts).toEqual({});
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('returns {} when the model call throws (never propagates)', async () => {
        openaiCreateMock.mockRejectedValueOnce(new Error('boom'));
        const facts = await operationalFactsExtractor.extract('x', CTX);
        expect(facts).toEqual({});
    });

    it('returns {} on a truncated (finish_reason=length) response', async () => {
        mockReply({ hours: { sat: '9am-8pm' } }, 'length');
        const facts = await operationalFactsExtractor.extract('x', CTX);
        expect(facts).toEqual({});
    });
});
