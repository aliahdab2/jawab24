import { describe, it, expect } from 'vitest';
import { typedAiErrorFromWire } from '../../src/services/aiWireErrors';
import {
    AiEmptyReplyError, AiRefusalError, AiTimeoutError, AiUnavailableError, AiQuotaExhaustedError,
} from '../../src/utils/fbGraphErrors';

/** An axios-shaped HTTP failure carrying the ai-worker's typed error body. */
function wire(body: unknown) {
    return Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: { error: body } } });
}

describe('typedAiErrorFromWire', () => {
    it.each([
        ['AiEmptyReplyError', AiEmptyReplyError],
        ['AiRefusalError', AiRefusalError],
        ['AiTimeoutError', AiTimeoutError],
        ['AiQuotaExhaustedError', AiQuotaExhaustedError],
    ])('reconstructs %s by name', (name, cls) => {
        const r = typedAiErrorFromWire(wire({ name, message: 'm' }));
        expect(r?.name).toBe(name);
        expect(r?.error).toBeInstanceOf(cls);
    });

    it('maps the ai-worker\'s AiClientNotConfiguredError to the backend\'s AiUnavailableError', () => {
        expect(typedAiErrorFromWire(wire({ name: 'AiClientNotConfiguredError', message: 'no key' }))?.error).toBeInstanceOf(AiUnavailableError);
    });

    it('carries the refusal reason through', () => {
        const r = typedAiErrorFromWire(wire({ name: 'AiRefusalError', message: 'm', refusalReason: 'policy' }));
        expect((r?.error as AiRefusalError).refusalReason).toBe('policy');
    });

    it('returns null for an unknown name, a bodiless error, a plain Error and a non-object — never invents a class', () => {
        expect(typedAiErrorFromWire(wire({ name: 'SomethingElse' }))).toBeNull();
        expect(typedAiErrorFromWire(wire({ message: 'no name' }))).toBeNull();
        expect(typedAiErrorFromWire(Object.assign(new Error('x'), { response: { status: 500, data: {} } }))).toBeNull();
        expect(typedAiErrorFromWire(new Error('ECONNREFUSED'))).toBeNull();
        expect(typedAiErrorFromWire('nope')).toBeNull();
        expect(typedAiErrorFromWire(null)).toBeNull();
    });

    it('accepts a plain object with the response shape (what hand-rolled axios mocks reject with)', () => {
        expect(typedAiErrorFromWire({ response: { data: { error: { name: 'AiEmptyReplyError' } } } })?.error).toBeInstanceOf(AiEmptyReplyError);
    });
});
