import { describe, it, expect } from 'vitest';
import { formatBusinessInfoPrompt } from '../businessInfoPrompt';
import type { BusinessProfile } from '../index';

// Regression guard for the BUSINESS_INFO prompt block. Locks in current
// formatter contract so the Option B refactor (auto-promoting FB suggestions
// into merchant with provenance) cannot silently break the prompt's
// anti-hallucination wording, the [NOT_PROVIDED] markers, or the
// null-on-empty behavior that saves prompt tokens.
describe('formatBusinessInfoPrompt', () => {
    describe('null / empty input', () => {
        it('returns null for null profile (no block injected)', () => {
            expect(formatBusinessInfoPrompt(null)).toBeNull();
        });

        it('returns null for undefined', () => {
            expect(formatBusinessInfoPrompt(undefined)).toBeNull();
        });

        it('returns null for empty object — no signal to add', () => {
            expect(formatBusinessInfoPrompt({})).toBeNull();
        });

        it('returns null when only language_hint is set (no signal fields)', () => {
            expect(formatBusinessInfoPrompt({ language_hint: 'ar' })).toBeNull();
        });
    });

    describe('populated profile', () => {
        it('emits the structured block header', () => {
            const block = formatBusinessInfoPrompt({ address: 'Damascus' });
            expect(block).toContain('BUSINESS_INFO');
            expect(block).toContain('structured, authoritative');
        });

        it('includes the anti-hallucination refusal directive at the TOP (must survive truncation)', () => {
            const block = formatBusinessInfoPrompt({ address: 'Damascus' });
            expect(block).not.toBeNull();
            const lines = block!.split('\n');
            // Directive must appear in the first three lines so the
            // BUSINESS_INFO_MAX_CHARS cap can't strip it for rich profiles.
            const directiveSlice = lines.slice(0, 3).join(' ');
            expect(directiveSlice).toContain('MUST NOT invent');
        });

        it('renders address verbatim', () => {
            const block = formatBusinessInfoPrompt({
                address: 'البرامكة سانا فوق مكتبة الحافظ',
            });
            expect(block).toContain('البرامكة سانا فوق مكتبة الحافظ');
        });

        it('joins address + city + country with commas', () => {
            const block = formatBusinessInfoPrompt({
                address: 'Baramkeh',
                city: 'Damascus',
                country: 'Syria',
            });
            expect(block).toContain('Baramkeh, Damascus, Syria');
        });

        it('renders phones as comma-joined list', () => {
            const block = formatBusinessInfoPrompt({
                phones: ['+963937549674', '0112124472'],
            });
            expect(block).toContain('+963937549674, 0112124472');
        });

        it('falls back to legacy `phone` when `phones` is missing', () => {
            const block = formatBusinessInfoPrompt({
                phone: '0935924472',
            } as BusinessProfile);
            expect(block).toContain('0935924472');
        });

        it('marks missing fields as [NOT_PROVIDED] (anti-hallucination)', () => {
            const block = formatBusinessInfoPrompt({
                address: 'Damascus',
                // phones, hours, policies all missing
            });
            expect(block).toContain('Phones: [NOT_PROVIDED]');
            expect(block).toContain('Hours: [NOT_PROVIDED]');
            expect(block).toContain('Policies: [NOT_PROVIDED]');
        });

        it('renders hours in day order, not insertion order', () => {
            const block = formatBusinessInfoPrompt({
                hours: {
                    fri: ['closed'],
                    mon: ['09:00-17:00'],
                    sun: ['10:00-14:00'],
                },
            });
            expect(block).not.toBeNull();
            const mondayIdx = block!.indexOf('Monday');
            const fridayIdx = block!.indexOf('Friday');
            const sundayIdx = block!.indexOf('Sunday');
            expect(mondayIdx).toBeGreaterThan(-1);
            expect(mondayIdx).toBeLessThan(fridayIdx);
            expect(fridayIdx).toBeLessThan(sundayIdx);
        });
    });

    describe('the exact prod failure case (the "عنوان" regression)', () => {
        // The merchant in question (page 39aeab89) has rich data in
        // `suggestions` but `merchant: {}`. This pins the contract:
        // when merchant is empty, the block must be null — i.e. the
        // current behavior is correct in isolation; the bug lives in
        // the caller path that fails to promote suggestions → merchant.
        // After Option B lands, the caller will pass a populated merchant
        // here and this same test will keep passing.
        it('returns null for an empty merchant (locks in the gate)', () => {
            expect(formatBusinessInfoPrompt({})).toBeNull();
        });

        it('returns the address block for a merchant populated from FB-sync (post-Option-B contract)', () => {
            const promotedFromFb: BusinessProfile = {
                address: 'البرامكة سانا فوق مكتبة الحافظ الطابق الاول, Damascus, Syria',
                phones: ['+963937549674'],
                hours: {
                    mon: ['08:00-20:00'],
                    tue: ['08:00-20:00'],
                    wed: ['08:00-20:00'],
                    thu: ['08:00-20:00'],
                    fri: ['00:00-23:45'],
                    sat: ['08:00-20:00'],
                    sun: ['08:00-20:00'],
                },
            };
            const block = formatBusinessInfoPrompt(promotedFromFb);
            expect(block).not.toBeNull();
            expect(block).toContain('البرامكة سانا');
            expect(block).toContain('+963937549674');
            expect(block).toContain('Monday: 08:00-20:00');
        });
    });
});
