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
import {
    matchCollections,
    matchAttributeValues,
    createAttributeScope,
    composeFactMatchText,
    type AttributeCell,
    type MatcherCollection,
    type ScopeRow,
} from '../services/factCollectionsMatcher';
import {
    DAMASCUS_COURSE_PRICES,
    damascusPriceRowInputs,
    damascusScheduleRowInputs,
} from '../plugins/demo/damascusLists';

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

/**
 * H-1 (multi-turn row starvation): the matcher's input for a DM is the recent
 * USER turns plus the current burst. A customer who stated their area minutes
 * ago — outside the seconds-scale consolidation window — must keep matching, or
 * the rows stay withheld for the rest of the conversation and no follow-up can
 * ever surface an outlet name.
 */
/**
 * The sub-key half (2026-08-06). Cells are taken from the page's rows exactly as
 * factCollections.ts passes them: every live row's attributes, across every
 * collection — which is what lets «محادثة», a level stored only in the PRICE list,
 * constrain the SCHEDULES list where it has no row.
 */
describe('matchAttributeValues', () => {
    const CELLS: AttributeCell[] = [
        // schedules rows
        { label: 'الدورة', value: 'انكليزي' }, { label: 'المستوى', value: 'مبتدئ' },
        { label: 'الأيام', value: 'السبت والأربعاء' }, { label: 'الساعة', value: '12-1' },
        { label: 'الدورة', value: 'انكليزي' }, { label: 'المستوى', value: 'متوسط 2' },
        { label: 'الأيام', value: 'الأحد والثلاثاء' }, { label: 'الساعة', value: '11-12' },
        // price rows — where «محادثة» lives, and nowhere else
        { label: 'المستوى', value: 'محادثة' },
    ];
    const hits = (message: string): Record<string, string[]> =>
        Object.fromEntries([...matchAttributeValues(message, CELLS)].map(([k, v]) => [k, [...v]]));

    it('finds a level the customer named, under its own label', () => {
        expect(hits('ايمتا التسجيل بدورة المحادثة لغة انكليزي')).toEqual({
            'الدورة': ['انكليزي'],
            'المستوى': ['محادثة'],
        });
    });

    it('groups by label — a value can never constrain a label it was not stored under', () => {
        // The whole attribution discipline in one assertion: «مبتدئ» is a level, so
        // it may narrow «المستوى» and must never appear under «الدورة».
        const h = hits('بدي انكليزي مبتدئ');
        expect(h['المستوى']).toEqual(['مبتدئ']);
        expect(h['الدورة']).toEqual(['انكليزي']);
    });

    it('returns nothing when the customer named no stored value', () => {
        expect(hits('مرحبا شو الأخبار')).toEqual({});
    });

    it('returns nothing for an empty message', () => {
        expect(hits('   ')).toEqual({});
    });

    it('dedupes repeated values and reports them AS STORED', () => {
        // The row set repeats «انكليزي» on every English row; the constraint is a set.
        expect(hits('انكليزي انكليزي')['الدورة']).toEqual(['انكليزي']);
    });

    it('uses the shared normalizer (alef/taa-marbuta variants still match)', () => {
        expect(hits('بدي دورة المحادثه')['المستوى']).toEqual(['محادثة']);
    });

    it('refuses a value shorter than two characters', () => {
        // A one-letter value occurs in almost any message — unmatchable, not a hit.
        expect([...matchAttributeValues('عندي سؤال', [{ label: 'المقاس', value: 'س' }])]).toEqual([]);
    });

    it('ignores cells with an empty label or value', () => {
        expect([...matchAttributeValues('انكليزي', [
            { label: '', value: 'انكليزي' },
            { label: 'الدورة', value: '   ' },
        ])]).toEqual([]);
    });

    /**
     * A LETTER-FREE value needs a token boundary (2026-08-06, external review).
     * Schedule rows store «الساعة» as «2-4»/«1-2»/«5-6» — three characters, no
     * letters — and bare containment finds them inside any digit run. The matcher
     * reads the conversation's earlier USER turns (composeFactMatchText), so a
     * phone number typed once constrained every later question in that thread.
     */
    describe('letter-free values need a token boundary', () => {
        const TIMES: AttributeCell[] = [
            { label: 'الساعة', value: '2-4' },
            { label: 'الساعة', value: '1-2' },
        ];

        it('does not match a time glued inside a phone number', () => {
            // «0932-4567» contains «2-4». Before the boundary rule this withheld
            // every ICDL cohort whose slot time was not 2-4 — five live cohorts.
            expect([...matchAttributeValues('ايمتا تبدأ دورة ICDL؟ رقمي 0932-4567', TIMES)]).toEqual([]);
        });

        it('still matches a time the customer actually asked about', () => {
            const hits = matchAttributeValues('عندكم شي الساعة 2-4؟', TIMES);
            expect([...(hits.get('الساعة') ?? [])]).toEqual(['2-4']);
        });

        it('matches a time at the very end of the message', () => {
            const hits = matchAttributeValues('بدي الدورة 1-2', TIMES);
            expect([...(hits.get('الساعة') ?? [])]).toEqual(['1-2']);
        });

        it('keeps Arabic prefix-gluing working for values that DO have letters', () => {
            // The boundary must NOT apply here: Arabic glues prefixes to the word,
            // and «عين الدالية» inside «بعين الدالية» is the place mechanism's
            // load-bearing match.
            const hits = matchAttributeValues('نلقاكم بعين الدالية؟', [{ label: 'المنطقة', value: 'عين الدالية' }]);
            expect([...(hits.get('المنطقة') ?? [])]).toEqual(['عين الدالية']);
        });
    });
});

/**
 * CO-SCOPING (2026-08-06, external review) — pinned against the REAL الدمشقي
 * fixture, not a hand-built one. The defect only exists because that page's level
 * vocabulary («مبتدئ / متقدم / محترف / محادثة / متوسط 1…») is shared across
 * unrelated courses, so a synthetic fixture would be free to be tidier than the
 * data and prove nothing.
 */
describe('createAttributeScope', () => {
    const TODAY = '2026-08-06';
    const ROWS: ScopeRow[] = [
        ...damascusPriceRowInputs(DAMASCUS_COURSE_PRICES),
        ...damascusScheduleRowInputs(TODAY),
    ].map(r => ({ name: r.name, attributes: r.attributes ?? null }));

    /** What the schedules gate would apply for `message`, given its key match. */
    const constraintsFor = (message: string, matchedKeys: string[]): Record<string, string[]> => {
        const matches = matchAttributeValues(message, ROWS.flatMap(r => r.attributes ?? []));
        const scoped = createAttributeScope(ROWS, matches)(matchedKeys);
        return Object.fromEntries([...scoped].map(([k, v]) => [k, [...v]]));
    };

    it('keeps a level recorded against the course the customer named', () => {
        // «محادثة» is priced under «اللغة الإنكليزية» and has no cohort — the whole
        // S9 mechanism. The key match «انكليزي» reaches that price row's name.
        expect(constraintsFor('ايمتا التسجيل بدورة المحادثة لغة انكليزي', ['انكليزي'])['المستوى'])
            .toEqual(['محادثة']);
    });

    it('drops a level that belongs only to OTHER courses', () => {
        // «متقدم» prices الحلاقة and الأمين; it is not an English level at all.
        // Unscoped it withheld all nine live انكليزي cohorts and the reply said
        // there were no announced dates.
        // «الدورة» survives — it is the key itself, and the gate skips its own key
        // label. What must NOT survive is a constraint on «المستوى».
        expect(constraintsFor('ايمتا تبدأ دورات الانكليزي؟ أنا متقدم بالانكليزي', ['انكليزي'])['المستوى'])
            .toBeUndefined();
    });

    it('drops «محترف» for the same reason', () => {
        expect(constraintsFor('ايمتا تبدأ دورات الانكليزي؟ صراحة أنا محترف', ['انكليزي'])['المستوى'])
            .toBeUndefined();
    });

    it('keeps a level the named course DOES record, even with no cohort for it', () => {
        // الأمين is priced at مبتدئ/متقدم/محترف and only مبتدئ has slots. Naming
        // متقدم here is in scope, so the gate may legitimately show no rows —
        // that is the designed behaviour, not a false denial.
        expect(constraintsFor('ايمتا تبدأ دورة الأمين للمحاسبة؟ أنا متقدم شوي', ['الأمين'])['المستوى'])
            .toEqual(['متقدم']);
    });

    it('is empty when the customer named no key at all', () => {
        expect(constraintsFor('أنا مبتدئ', [])).toEqual({});
    });
});

describe('composeFactMatchText', () => {
    const history = [
        { role: 'user' as const, content: 'أنا ساكن في عين الدالية، وين نلقى منتجاتكم؟' },
        { role: 'assistant' as const, content: 'منتجاتنا متوفرة في عدة صيدليات في عين الدالية.' },
    ];

    it('keeps matching an area stated in an earlier user turn (the dead-end case)', () => {
        const matchText = composeFactMatchText(history, 'شن أسامي الصيدليات بالضبط؟');
        expect(matched(matchText)).toEqual([['عين الدالية'], []]);
    });

    // The planted-history probe (#737) is an ASSISTANT turn asserting outlets in
    // a city that is in no list. If assistant turns fed the matcher, a fabricated
    // reply naming a real listed area for the wrong city would re-open that
    // area's rows — the matcher trusting the very output it exists to constrain.
    it('never reads assistant turns', () => {
        const fabricated = [
            { role: 'assistant' as const, content: 'في العجيلات متوفر في صيدليات سوق الخميس.' },
        ];
        const matchText = composeFactMatchText(fabricated, 'طيب وين ألقاكم؟');
        expect(matchText).toBe('طيب وين ألقاكم؟');
        expect(matched(matchText)).toEqual([[], []]);
    });

    it('returns the current text unchanged with no history', () => {
        expect(composeFactMatchText(undefined, 'وين نلقاكم؟')).toBe('وين نلقاكم؟');
        expect(composeFactMatchText([], 'وين نلقاكم؟')).toBe('وين نلقاكم؟');
    });

    it('skips empty/whitespace user turns', () => {
        const noisy = [
            { role: 'user' as const, content: '   ' },
            { role: 'user' as const, content: 'أنا في صبراتة' },
        ];
        expect(composeFactMatchText(noisy, 'وين؟')).toBe('أنا في صبراتة\nوين؟');
    });
});
