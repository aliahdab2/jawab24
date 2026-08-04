/**
 * Route-boundary validation for PUT /pages/:id `messengerProfile`
 * (utils/validation.ts#MessengerProfileConfigSchema). Limits per Meta docs:
 * greeting ≤ 160 (documented), ≤ 4 ice breakers (documented), question ≤ 80
 * (our cap — Meta documents none).
 */
import { describe, it, expect } from 'vitest';
import { MessengerProfileConfigSchema, validateSchema } from '../utils/validation';
import {
    MESSENGER_GREETING_MAX,
    MESSENGER_ICE_BREAKERS_MAX,
    MESSENGER_ICE_BREAKER_QUESTION_MAX,
} from '@jawab24/shared';

const valid = {
    enabled: true,
    greeting: { ar: 'أهلًا بك 👋', en: 'Welcome!' },
    iceBreakers: ['ما الأسعار؟', 'كيف أطلب؟'],
};

describe('MessengerProfileConfigSchema', () => {
    it('accepts a full valid config', () => {
        expect(validateSchema(MessengerProfileConfigSchema, valid).success).toBe(true);
    });

    it('accepts a disabled config with everything empty', () => {
        const result = validateSchema(MessengerProfileConfigSchema, {
            enabled: false, greeting: {}, iceBreakers: [],
        });
        expect(result.success).toBe(true);
    });

    it('accepts an enabled ice-breakers-only config (no greeting)', () => {
        const result = validateSchema(MessengerProfileConfigSchema, {
            enabled: true, greeting: {}, iceBreakers: ['ما الأسعار؟'],
        });
        expect(result.success).toBe(true);
    });

    it('rejects an enabled config with no greeting and no questions', () => {
        const result = validateSchema(MessengerProfileConfigSchema, {
            enabled: true, greeting: { ar: '  ' }, iceBreakers: ['', '  '],
        });
        expect(result.success).toBe(false);
    });

    it(`rejects a greeting over ${MESSENGER_GREETING_MAX} chars (Meta cap)`, () => {
        const result = validateSchema(MessengerProfileConfigSchema, {
            ...valid,
            greeting: { ar: 'ن'.repeat(MESSENGER_GREETING_MAX + 1) },
        });
        expect(result.success).toBe(false);
    });

    it(`rejects more than ${MESSENGER_ICE_BREAKERS_MAX} ice breakers (Meta cap)`, () => {
        const result = validateSchema(MessengerProfileConfigSchema, {
            ...valid,
            iceBreakers: ['١', '٢', '٣', '٤', '٥'],
        });
        expect(result.success).toBe(false);
    });

    it(`rejects a question over ${MESSENGER_ICE_BREAKER_QUESTION_MAX} chars`, () => {
        const result = validateSchema(MessengerProfileConfigSchema, {
            ...valid,
            iceBreakers: ['س'.repeat(MESSENGER_ICE_BREAKER_QUESTION_MAX + 1)],
        });
        expect(result.success).toBe(false);
    });

    it('rejects unknown keys — the body is forwarded to the Graph API', () => {
        expect(validateSchema(MessengerProfileConfigSchema, { ...valid, surprise: 1 }).success).toBe(false);
        expect(validateSchema(MessengerProfileConfigSchema, {
            ...valid, greeting: { ar: 'أهلًا', fr: 'Bonjour' },
        }).success).toBe(false);
    });

    it('rejects missing required keys', () => {
        expect(validateSchema(MessengerProfileConfigSchema, { greeting: {}, iceBreakers: [] }).success).toBe(false);
        expect(validateSchema(MessengerProfileConfigSchema, { enabled: true, iceBreakers: [] }).success).toBe(false);
        expect(validateSchema(MessengerProfileConfigSchema, { enabled: true, greeting: {} }).success).toBe(false);
    });
});
