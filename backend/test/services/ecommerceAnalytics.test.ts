import { describe, it, expect } from 'vitest';
import {
    bucketForStatus,
    emptyFunnel,
    extractCurrency,
    parseAmount,
} from '../../src/services/ecommerceAnalytics';

describe('ecommerceAnalytics — pure helpers', () => {
    describe('parseAmount', () => {
        it('parses a plain number string', () => {
            expect(parseAmount('120')).toBe(120);
        });
        it('parses an amount with currency suffix', () => {
            expect(parseAmount('120 SAR')).toBe(120);
        });
        it('parses decimals', () => {
            expect(parseAmount('120.50 SAR')).toBe(120.5);
        });
        it('parses currency-prefixed amount', () => {
            expect(parseAmount('$ 99.99')).toBe(99.99);
        });
        it('parses Arabic-tagged amount', () => {
            expect(parseAmount('250 ريال')).toBe(250);
        });
        it('returns 0 for null', () => {
            expect(parseAmount(null)).toBe(0);
        });
        it('returns 0 for empty string', () => {
            expect(parseAmount('')).toBe(0);
        });
        it('returns 0 for non-numeric input', () => {
            expect(parseAmount('SAR')).toBe(0);
        });
        it('handles negative amounts', () => {
            expect(parseAmount('-50.5 SAR')).toBe(-50.5);
        });
    });

    describe('bucketForStatus', () => {
        it('maps delivered to delivered', () => {
            expect(bucketForStatus('delivered')).toBe('delivered');
        });
        it('maps legacy sent to delivered (collapse so UI shows one number)', () => {
            expect(bucketForStatus('sent')).toBe('delivered');
        });
        it('maps failed to failed', () => {
            expect(bucketForStatus('failed')).toBe('failed');
        });
        it('maps pending to pending', () => {
            expect(bucketForStatus('pending')).toBe('pending');
        });
        it('falls back to pending for unknown statuses', () => {
            expect(bucketForStatus('queued')).toBe('pending');
            expect(bucketForStatus('odd_value')).toBe('pending');
        });
        it('falls back to pending for null', () => {
            expect(bucketForStatus(null)).toBe('pending');
        });
    });

    describe('emptyFunnel', () => {
        it('returns a zeroed funnel', () => {
            expect(emptyFunnel()).toEqual({ sent: 0, delivered: 0, failed: 0, pending: 0 });
        });
        it('returns a fresh object each call (no shared mutation)', () => {
            const a = emptyFunnel();
            a.delivered = 99;
            expect(emptyFunnel().delivered).toBe(0);
        });
    });

    describe('extractCurrency', () => {
        it('extracts ISO 3-letter currency code', () => {
            expect(extractCurrency('120 SAR')).toBe('SAR');
            expect(extractCurrency('99.99 USD')).toBe('USD');
        });
        it('extracts symbol', () => {
            expect(extractCurrency('$50')).toBe('$');
            expect(extractCurrency('€100')).toBe('€');
        });
        it('extracts Arabic currency words', () => {
            expect(extractCurrency('250 ريال')).toBe('ريال');
            expect(extractCurrency('100 درهم')).toBe('درهم');
        });
        it('returns null for missing currency', () => {
            expect(extractCurrency('120')).toBe(null);
        });
        it('returns null for null input', () => {
            expect(extractCurrency(null)).toBe(null);
        });
    });
});
