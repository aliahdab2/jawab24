import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/redis', () => ({
    redis: { incr: vi.fn().mockResolvedValue(1) },
}));
vi.mock('../../src/config', () => ({
    config: { ai: {}, openai: { apiKey: 'test-key' } },
}));

const mockCreate = vi.fn();
vi.mock('../../src/services/openaiClient', () => ({
    makeTrackedOpenAI: vi.fn(() => ({ chat: { completions: { create: mockCreate } } })),
}));

import {
    buildTransformPrompt,
    digitSequence,
    invarianceViolation,
    parseTransformResponse,
    generateGenderVariant,
} from '../../src/services/genderVariantTransform';

describe('buildTransformPrompt', () => {
    it('names the target gender and embeds the reply verbatim as JSON', () => {
        const prompt = buildTransformPrompt('تفضّل يا غالي، السعر ٥٠ ألف', 'f');
        expect(prompt).toContain('feminine');
        expect(prompt).toContain(JSON.stringify('تفضّل يا غالي، السعر ٥٠ ألف'));
        expect(buildTransformPrompt('x', 'm')).toContain('masculine');
    });
});

describe('digitSequence / invarianceViolation', () => {
    it('treats Arabic-Indic and ASCII digits as the same sequence', () => {
        expect(digitSequence('السعر ٥٠ والتوصيل ٥')).toEqual(['50', '5']);
        // Digit-script change alone is invariant (both normalize to '50').
        expect(invarianceViolation('السعر ٥٠', 'السعر 50')).toBeNull();
    });

    it('rejects any changed, dropped, or reordered number', () => {
        expect(invarianceViolation('السعر ٥٠', 'السعر ١٥')).toBe('numbers_changed');
        expect(invarianceViolation('السعر ٥٠ والتوصيل ٥', 'السعر ٥٠')).toBe('numbers_changed');
        expect(invarianceViolation('من ٩ إلى ٥', 'من ٥ إلى ٩')).toBe('numbers_changed');
    });

    it('rejects large length drift (content gained or lost)', () => {
        const original = 'تفضلي حبيبتي المنتج متوفر';
        expect(invarianceViolation(original, original.repeat(2))).toBe('length_drift');
        expect(invarianceViolation(original, 'متوفر')).toBe('length_drift');
        // Suffix-scale morphology changes stay within the band.
        expect(invarianceViolation('تفضل حبيبي المنتج متوفر', 'تفضلي حبيبتي المنتج متوفر')).toBeNull();
    });
});

describe('parseTransformResponse', () => {
    it('parses the happy path and rejects garbage', () => {
        expect(parseTransformResponse('{"reply":"تفضّلي"}')).toBe('تفضّلي');
        expect(parseTransformResponse('{"reply":""}')).toBeNull();
        expect(parseTransformResponse('{"reply":42}')).toBeNull();
        expect(parseTransformResponse('not json')).toBeNull();
        expect(parseTransformResponse(null)).toBeNull();
    });
});

describe('generateGenderVariant', () => {
    it('returns the variant when the transform is content-invariant', async () => {
        mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '{"reply":"تفضّلي، السعر ٥٠"}' } }] });
        const variant = await generateGenderVariant({ userId: 'u1', reply: 'تفضّل، السعر ٥٠', sourceGender: 'm' });
        expect(variant).toBe('تفضّلي، السعر ٥٠');
        const params = mockCreate.mock.calls[0][0];
        expect(params.temperature).toBe(0);
        expect(params.response_format).toEqual({ type: 'json_object' });
    });

    it('returns null (never throws) on price drift, garbage, or API failure', async () => {
        mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '{"reply":"تفضّلي، السعر ١٥"}' } }] });
        expect(await generateGenderVariant({ userId: 'u1', reply: 'تفضّل، السعر ٥٠', sourceGender: 'm' })).toBeNull();

        mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'garbage' } }] });
        expect(await generateGenderVariant({ userId: 'u1', reply: 'تفضّل', sourceGender: 'm' })).toBeNull();

        mockCreate.mockRejectedValueOnce(new Error('rate limit'));
        expect(await generateGenderVariant({ userId: 'u1', reply: 'تفضّل', sourceGender: 'm' })).toBeNull();
    });
});
