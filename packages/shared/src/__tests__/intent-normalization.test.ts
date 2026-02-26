import { describe, it, expect } from 'vitest';
import { normalizeAiIntent, VALID_AI_INTENTS } from '../index';

describe('normalizeAiIntent', () => {
    it('returns undefined for undefined input', () => {
        expect(normalizeAiIntent(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
        expect(normalizeAiIntent('')).toBeUndefined();
    });

    it('passes through valid intents unchanged', () => {
        for (const intent of VALID_AI_INTENTS) {
            expect(normalizeAiIntent(intent)).toBe(intent);
        }
    });

    it('normalizes case (lowercase → UPPERCASE)', () => {
        expect(normalizeAiIntent('question')).toBe('QUESTION');
        expect(normalizeAiIntent('Offensive')).toBe('OFFENSIVE');
        expect(normalizeAiIntent('spam_or_irrelevant')).toBe('SPAM_OR_IRRELEVANT');
    });

    it('trims whitespace', () => {
        expect(normalizeAiIntent('  QUESTION  ')).toBe('QUESTION');
    });

    // Question-like invented intents
    it('maps PRICE → QUESTION', () => {
        expect(normalizeAiIntent('PRICE')).toBe('QUESTION');
    });

    it('maps LOCATION → QUESTION', () => {
        expect(normalizeAiIntent('LOCATION')).toBe('QUESTION');
    });

    it('maps HOURS → QUESTION', () => {
        expect(normalizeAiIntent('HOURS')).toBe('QUESTION');
    });

    it('maps OFFERING_INFO → QUESTION', () => {
        expect(normalizeAiIntent('OFFERING_INFO')).toBe('QUESTION');
    });

    it('maps INFO_OFFERING → QUESTION', () => {
        expect(normalizeAiIntent('INFO_OFFERING')).toBe('QUESTION');
    });

    it('maps POLICY → QUESTION', () => {
        expect(normalizeAiIntent('POLICY')).toBe('QUESTION');
    });

    it('maps AVAILABILITY → QUESTION', () => {
        expect(normalizeAiIntent('AVAILABILITY')).toBe('QUESTION');
    });

    // Sentiment-like
    it('maps POSITIVE → COMPLIMENT', () => {
        expect(normalizeAiIntent('POSITIVE')).toBe('COMPLIMENT');
    });

    it('maps NEGATIVE → COMPLAINT', () => {
        expect(normalizeAiIntent('NEGATIVE')).toBe('COMPLAINT');
    });

    // Purchase-like
    it('maps ORDER → PURCHASE_INTENT', () => {
        expect(normalizeAiIntent('ORDER')).toBe('PURCHASE_INTENT');
    });

    // Offensive-like
    it('maps ABUSE → OFFENSIVE', () => {
        expect(normalizeAiIntent('ABUSE')).toBe('OFFENSIVE');
    });

    it('maps INSULT → OFFENSIVE', () => {
        expect(normalizeAiIntent('INSULT')).toBe('OFFENSIVE');
    });

    // Spam-like
    it('maps SPAM → SPAM_OR_IRRELEVANT', () => {
        expect(normalizeAiIntent('SPAM')).toBe('SPAM_OR_IRRELEVANT');
    });

    it('maps SELF_PROMOTION → SPAM_OR_IRRELEVANT', () => {
        expect(normalizeAiIntent('SELF_PROMOTION')).toBe('SPAM_OR_IRRELEVANT');
    });

    // Unknown intents pass through uppercased
    it('returns OTHER as-is (uppercased) when no mapping exists', () => {
        expect(normalizeAiIntent('OTHER')).toBe('OTHER');
    });

    it('returns GENERAL as-is (uppercased) when no mapping exists', () => {
        expect(normalizeAiIntent('GENERAL')).toBe('GENERAL');
    });
});
