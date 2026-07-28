/**
 * The deterministic matcher (G1 stage L2) — the comparison the model kept getting
 * wrong, pinned in code.
 *
 * These tests exist because two attempts to make the MODEL perform this comparison
 * were measured and failed: a prompt rule («match exactly, resemblance is not a
 * match») was neutral (8/48 fabrications either way), and stating the computed
 * result as a prompt fact was worse (12/48). The comparison now happens here, so
 * here is where it must be pinned — a regression in this file is a regression in
 * what the reply model is allowed to see.
 */
import { describe, it, expect } from 'vitest';
import { matchCollections, type MatcherCollection } from '../services/factCollectionsMatcher';

/** The fixture's real shape: a district-keyed outlet list + a city-keyed one. */
const AREAS: MatcherCollection = {
    label: 'صيدليات المدينة',
    keyAttr: 'المنطقة',
    keyValues: ['حي الرمال', 'تلة الريح', 'سوق الخميس', 'عين الدالية', 'وادي الرمان'],
};
const CITIES: MatcherCollection = {
    label: 'منافذ غرب المدينة',
    keyAttr: 'المدينة',
    keyValues: ['صبراتة', 'صرمان', 'زلطن'],
};

const matched = (message: string, collections = [AREAS, CITIES]) =>
    matchCollections(message, collections).map(m => m.matched);

describe('matchCollections', () => {
    it('matches a stored value contained in a longer message', () => {
        expect(matched('أنا ساكن في عين الدالية، وين نلقى منتجاتكم؟')).toEqual([['عين الدالية'], []]);
    });

    // THE LOAD-BEARING CASE. «سوق الثلاثاء» is the business's own address and
    // «سوق الخميس» is a registered area; they share the word «سوق». The model
    // accepted one as the other in 5 of 6 measured runs. Code must not.
    it('does NOT match a near-name that merely shares a word', () => {
        expect(matched('سوق الثلاثاء فيه صيدليات تبيع منتجاتكم؟')).toEqual([[], []]);
    });

    it('does not match a place absent from every list (the prod العجيلات shape)', () => {
        expect(matched('العجيلات، وين نلقى منتجاتكم؟')).toEqual([[], []]);
    });

    it('matches the right collection when the key differs («المدينة» vs «المنطقة»)', () => {
        expect(matched('أنا في صبراتة، وين ألقى منتجاتكم؟')).toEqual([[], ['صبراتة']]);
    });

    it('matches several values in one message without duplicating them', () => {
        expect(matched('عندكم في حي الرمال أو تلة الريح أو حي الرمال؟')).toEqual([['حي الرمال', 'تلة الريح'], []]);
    });

    // A PARTIAL value is a deliberate miss, not a bug: matching «الرمال» would open
    // the door to the near-name failure above. The cost is bounded — the coverage
    // statement still names «حي الرمال», so the customer sees their area listed and
    // the reply can still answer them. Under-answering beats misdirecting.
    it('treats a partial value as no match, by design', () => {
        expect(matched('أنا من الرمال')).toEqual([[], []]);
    });

    it('ignores diacritics, alef variants and taa marbuta (shared normalizer)', () => {
        expect(matched('أنا في عين الداليه')).toEqual([['عين الدالية'], []]);
        expect(matched('سَاكِن في تلّة الريح')).toEqual([['تلة الريح'], []]);
    });

    it('returns nothing for an empty or whitespace message', () => {
        expect(matchCollections('', [AREAS])).toEqual([]);
        expect(matchCollections('   \n ', [AREAS])).toEqual([]);
    });

    it('skips un-keyed collections — with no key there is nothing to compare', () => {
        const unkeyed: MatcherCollection = { label: 'خدماتنا', keyAttr: null, keyValues: ['أي شيء'] };
        expect(matchCollections('أي شيء', [unkeyed])).toEqual([]);
    });

    it('skips a collection with no key values (an index of nothing is not a boundary)', () => {
        expect(matchCollections('حي الرمال', [{ ...AREAS, keyValues: [] }])).toEqual([]);
    });

    // A one-character value would occur in almost any message and would silently
    // un-gate the whole list.
    it('refuses to match on a single-character value', () => {
        expect(matchCollections('نبي حفاضات', [{ ...AREAS, keyValues: ['ا'] }])[0].matched).toEqual([]);
    });

    it('reports the value as STORED, not as the customer typed it', () => {
        // The gate filters rows by the stored attribute value, so the returned
        // string must be the stored one or nothing matches downstream.
        expect(matchCollections('في عين الداليه', [AREAS])[0].matched).toEqual(['عين الدالية']);
    });
});
