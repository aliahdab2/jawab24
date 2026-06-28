import { describe, it, expect } from 'vitest';
import {
    isInsufficientQuotaError,
    AiQuotaExhaustedError,
    AI_TYPED_ERROR_NAMES,
    serializeTypedAiError,
} from '../src/lib/errors';

describe('isInsufficientQuotaError', () => {
    it('detects the real OpenAI SDK shape (status 429 + code on the error)', () => {
        // Mirrors the prod log shape: RateLimitError with status 429 and
        // code "insufficient_quota" both on the error and nested under .error
        const err = Object.assign(new Error('429 You exceeded your current quota'), {
            status: 429,
            code: 'insufficient_quota',
            error: { type: 'insufficient_quota', code: 'insufficient_quota' },
        });
        expect(isInsufficientQuotaError(err)).toBe(true);
    });

    it('detects when only the nested error carries the code', () => {
        const err = Object.assign(new Error('429'), {
            status: 429,
            error: { code: 'insufficient_quota' },
        });
        expect(isInsufficientQuotaError(err)).toBe(true);
    });

    it('accepts the quota marker even when status is missing (some SDK wrappers drop it)', () => {
        const err = Object.assign(new Error('quota'), { code: 'insufficient_quota' });
        expect(isInsufficientQuotaError(err)).toBe(true);
    });

    it('does NOT match a plain 429 rate-limit (genuinely transient, keep fast retry)', () => {
        const err = Object.assign(new Error('429 Rate limit reached'), {
            status: 429,
            code: 'rate_limit_exceeded',
        });
        expect(isInsufficientQuotaError(err)).toBe(false);
    });

    it('does NOT match a 500 / other errors', () => {
        expect(isInsufficientQuotaError(Object.assign(new Error('500'), { status: 500 }))).toBe(false);
        expect(isInsufficientQuotaError(new Error('socket hang up'))).toBe(false);
        expect(isInsufficientQuotaError(null)).toBe(false);
        expect(isInsufficientQuotaError(undefined)).toBe(false);
        expect(isInsufficientQuotaError('insufficient_quota')).toBe(false);
    });
});

describe('AiQuotaExhaustedError typed-error contract', () => {
    it('is registered so routes.ts serializes it as a typed 500 (not Sentry-captured noise)', () => {
        expect(AI_TYPED_ERROR_NAMES.has('AiQuotaExhaustedError')).toBe(true);
    });

    it('serializes to the wire shape the backend reconstructs by name', () => {
        const serialized = serializeTypedAiError(new AiQuotaExhaustedError());
        expect(serialized).toEqual({
            name: 'AiQuotaExhaustedError',
            message: 'OpenAI quota exhausted (insufficient_quota)',
        });
    });
});
