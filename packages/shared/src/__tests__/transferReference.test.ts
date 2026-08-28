/**
 * The transfer reference is the anti-replay key for the offline payment rail:
 * one real transfer, one claim. Uniqueness is enforced on the NORMALIZED form,
 * so anything this function fails to fold is a way to submit the same receipt
 * twice — and on an offline rail that means renewing a subscription for free.
 *
 * Merchants retype a reference off a phone screen, on Arabic and Latin
 * keyboards, with whatever spacing the wallet app printed.
 */
import { describe, it, expect } from 'vitest';
import { normalizeTransferReference } from '../constants';

describe('normalizeTransferReference', () => {
    it('folds Arabic-Indic digits to ASCII', () => {
        expect(normalizeTransferReference('٨٤٧١٩٢٠٣')).toBe('84719203');
    });

    it('folds Extended Arabic-Indic (Persian/Urdu keyboard) digits too', () => {
        expect(normalizeTransferReference('۸۴۷۱۹۲۰۳')).toBe('84719203');
    });

    it('collides every spelling of the same transfer', () => {
        const spellings = [
            '84719203',
            ' 84719203 ',
            '847-192-03',
            '847 192 03',
            '847.192.03',
            '847_192_03',
            '٨٤٧١٩٢٠٣',
            '۸۴۷۱۹۲۰۳',
        ];
        const normalized = new Set(spellings.map(normalizeTransferReference));
        expect(normalized).toEqual(new Set(['84719203']));
    });

    it('upper-cases alphanumeric references', () => {
        expect(normalizeTransferReference('sc-a1b2')).toBe('SCA1B2');
    });

    it('keeps DIFFERENT references distinct', () => {
        // The failure that would matter in the other direction: over-folding two
        // real transfers into one key rejects a merchant's genuine payment.
        expect(normalizeTransferReference('84719203'))
            .not.toBe(normalizeTransferReference('84719204'));
        expect(normalizeTransferReference('1234'))
            .not.toBe(normalizeTransferReference('12345'));
    });

    it('does not strip digits or letters', () => {
        expect(normalizeTransferReference('0001')).toBe('0001');
    });
});
