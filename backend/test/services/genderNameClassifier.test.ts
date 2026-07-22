import { describe, it, expect, vi } from 'vitest';
import {
    buildClassifierPrompt,
    parseClassifierResponse,
    classifyNamesBatch,
} from '../../src/services/genderNameClassifier';
import type { TrackedOpenAI } from '../../src/services/openaiClient';

describe('buildClassifierPrompt', () => {
    it('includes every name exactly as given, in order', () => {
        const prompt = buildClassifierPrompt(['محمد', 'فاطمة', 'mohamed']);
        expect(prompt).toContain('["محمد","فاطمة","mohamed"]');
        expect(prompt).toContain('unknown');
    });
});

describe('parseClassifierResponse', () => {
    it('maps the happy path', () => {
        const content = JSON.stringify({ classifications: [
            { name: 'محمد', gender: 'm' },
            { name: 'فاطمة', gender: 'f' },
            { name: 'نور', gender: 'unknown' },
        ] });
        expect(parseClassifierResponse(content, ['محمد', 'فاطمة', 'نور'])).toEqual([
            { name: 'محمد', gender: 'm' },
            { name: 'فاطمة', gender: 'f' },
            { name: 'نور', gender: 'unknown' },
        ]);
    });

    it('fills names missing from the response as unknown and drops hallucinated extras', () => {
        const content = JSON.stringify({ classifications: [
            { name: 'محمد', gender: 'm' },
            { name: 'خالد', gender: 'm' }, // never requested
        ] });
        expect(parseClassifierResponse(content, ['محمد', 'فاطمة'])).toEqual([
            { name: 'محمد', gender: 'm' },
            { name: 'فاطمة', gender: 'unknown' },
        ]);
    });

    it('coerces invalid gender values to unknown and keeps the first duplicate echo', () => {
        const content = JSON.stringify({ classifications: [
            { name: 'محمد', gender: 'male' },
            { name: 'فاطمة', gender: 'f' },
            { name: 'فاطمة', gender: 'm' }, // duplicate — first wins
        ] });
        expect(parseClassifierResponse(content, ['محمد', 'فاطمة'])).toEqual([
            { name: 'محمد', gender: 'unknown' },
            { name: 'فاطمة', gender: 'f' },
        ]);
    });

    it('never throws: unparseable JSON, wrong shapes, null content → all unknown', () => {
        for (const content of ['not json', '{}', '{"classifications": "x"}', null, undefined, '[]']) {
            expect(parseClassifierResponse(content, ['محمد'])).toEqual([{ name: 'محمد', gender: 'unknown' }]);
        }
    });
});

describe('classifyNamesBatch', () => {
    function mockClient(content: string) {
        const create = vi.fn().mockResolvedValue({ choices: [{ message: { content } }] });
        return { client: { chat: { completions: { create } } } as unknown as TrackedOpenAI, create };
    }

    it('calls the model deterministically (temperature 0, json_object) and parses the result', async () => {
        const { client, create } = mockClient(JSON.stringify({ classifications: [{ name: 'محمد', gender: 'm' }] }));
        const result = await classifyNamesBatch(client, 'gpt-4.1-mini', ['محمد']);

        expect(result).toEqual([{ name: 'محمد', gender: 'm' }]);
        const params = create.mock.calls[0][0];
        expect(params.model).toBe('gpt-4.1-mini');
        expect(params.temperature).toBe(0);
        expect(params.response_format).toEqual({ type: 'json_object' });
        expect(params.max_tokens).toBeGreaterThan(0);
    });

    it('returns [] without calling the API for an empty batch', async () => {
        const { client, create } = mockClient('');
        expect(await classifyNamesBatch(client, 'gpt-4.1-mini', [])).toEqual([]);
        expect(create).not.toHaveBeenCalled();
    });
});
