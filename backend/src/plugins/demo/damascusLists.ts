/**
 * Demo fixture — الفريق الدمشقي course lists (G1 schedules slice, D-052).
 *
 * The institute's enumerable facts move out of DAMASCUS_DEMO_KB prose into
 * fact_collections rows — the same engine, third real shape. THREE collections,
 * and the split is load-bearing (not taxonomy):
 *
 * 1. «أسعار الدورات» — UN-KEYED, UNDATED. The sizes-slice precedent (#551):
 *    a price table must always fully render («قديش أسعار الدورات؟» names no
 *    course), and it must NEVER expire — a course whose announced cohorts have
 *    all passed is still a real course with a real price.
 *
 * 2. «مواعيد الدورات المعلنة» — KEYED by «الدورة», rows = one COHORT SLOT each,
 *    self-expiring at their start date (endsAt = startsAt). This is the class
 *    that motivated the slice: 95 of the real merchant's 120 verifier firings
 *    were invented course schedules, plus 15/46 start dates already expired
 *    (the v38 stale-date class — his bot said «تبدأ الأحد 26/7» on 30/7).
 *    Expiry is decided in CODE (factCollections.ts query-time exclusion +
 *    renderer live-filter), never by model judgement (D-051).
 *
 *    ⚠️ WHY SCHEDULES MUST NOT SHARE A COLLECTION WITH PRICES: expired rows
 *    drop out of the renderer's coverage index, and an all-expired collection
 *    vanishes entirely. If course EXISTENCE were asserted by this collection,
 *    a course between cohorts would fall out of the boundary statement and the
 *    absence directive would manufacture a FALSE DENIAL of a real course. With
 *    the split, this list's label scopes its absence claim to *announced
 *    dates* — «لا موعد معلناً» stays true when cohorts pass — while existence
 *    and price stay grounded by collection 1, which never expires.
 *
 * 3. «الدورات الأونلاين المتوفرة» — KEYED by «الدورة», tiny, the merchant's own
 *    closed online list (ICDL / الإكسل / محاسبة الأمين only). The eval #503/#511
 *    family («دورة X أونلاين؟» must not be sycophantically affirmed) becomes a
 *    row-boundary question instead of a prose-comprehension one.
 *    MEASURED 2026-07-31: un-keyed, the generic absence line («أي عنصر غير
 *    مذكور…») had no teeth against a LEADING modality question — #503 affirmed
 *    «دورة الإنجليزية أونلاين» by fusing the price-list levels with the
 *    customer's framing, and battery S7 invented English online 1/4. Keying the
 *    list makes an unmatched course render the ENUMERATED boundary («هذه
 *    القائمة تغطي «الدورة» التالية فقط: …») — the same L1 coverage-statement
 *    mechanism that took the distributor's fabrication 28%→0. A matched course
 *    («بقديش ICDL أونلاين؟») still gets its row and price.
 *
 * Same mirror-the-real-KB rule as the distributor fixture: names, prices and
 * day/time patterns are the merchant's actual authoring (messy naming and all).
 * DATES are the exception, deliberately: the KB's real cohort dates are all
 * June–July 2026, i.e. already past. Slots here are split into (a) real dates
 * kept AS-IS — permanently expired, exercising suppression; (b) slots dated
 * RELATIVE to seed time (`start: { inDays }`) so the fixture always holds
 * genuinely upcoming cohorts for positive controls; (c) undated slots («تبدأ
 * عند اكتمال العدد») that never expire. A fixture with only-past dates could
 * never prove the model quotes a real upcoming date through the live path.
 *
 * The real KB carries an internal contradiction (صناعة المنظفات priced 50k in
 * one section and 100k in another). Rows are merchant-confirmed data, so the
 * fixture takes the twice-stated 50k; resolving that conflict for the REAL
 * page is exactly the extraction-with-owner-review step (D-038), not code.
 */
import {
    renderFactCollectionBlock,
    type FactRowForPrompt,
} from '../../services/factCollectionsRenderer';

/** fact_rows.currency is varchar(10) — the merchant's full phrasing «بالعملة
 *  القديمة» doesn't fit and belongs to prose anyway (the KB keeps the 100:1
 *  conversion note). 9 chars, and unambiguous next to it. */
export const DAMASCUS_OLD_SYP = 'ل.س قديمة';

interface PriceRowFixture {
    name: string;
    /** Key value for a KEYED price list (the online list) — the short way a
     *  customer names the course. Absent on the un-keyed main price list. */
    course?: string;
    level?: string;
    note?: string;
    price: string;
    currency?: string;
}

export const DAMASCUS_COURSE_PRICES: { label: string; rows: PriceRowFixture[] } = {
    label: 'أسعار الدورات',
    rows: [
        { name: 'دورة الحلاقة النسائية', level: 'مبتدئ', price: '35000' },
        { name: 'دورة الحلاقة النسائية', level: 'متقدم', price: '50000' },
        { name: 'دورة الحلاقة النسائية', level: 'محترف', price: '75000' },
        { name: 'صبغات', price: '100000' },
        { name: 'شنيون', price: '100000' },
        { name: 'دورة الأظافر', price: '100000' },
        { name: 'دورة العناية بالبشرة', price: '500000' },
        { name: 'دورة المكياج او التجميل', level: 'مبتدئ', price: '35000' },
        { name: 'دورة الحلاقة الرجالية', level: 'مبتدئ', price: '50000' },
        { name: 'دورة الحلاقة الرجالية', level: 'متقدم', price: '75000' },
        { name: 'دورة الحلاقة الرجالية', level: 'محترف', price: '100000' },
        { name: 'دورة التمريض', level: 'الأول (الإسعافات الأولية)', price: '35000' },
        { name: 'دورة التمريض', level: 'الثاني', price: '50000' },
        { name: 'دورة التمريض', level: 'الثالث', price: '75000' },
        { name: 'دورة ICDL', note: '8 جلسات لمدة شهر', price: '35000' },
        { name: 'دورة إدخال البيانات', price: '100000' },
        { name: 'دورة الإكسل المتقدم', price: '50000' },
        { name: 'اللغة الإنكليزية', level: 'مبتدئ', price: '35000' },
        { name: 'اللغة الإنكليزية', level: 'متوسط 1', price: '50000' },
        { name: 'اللغة الإنكليزية', level: 'متوسط 2', price: '50000' },
        { name: 'اللغة الإنكليزية', level: 'محادثة', price: '75000' },
        { name: 'اللغة الهولندية', price: '500000' },
        { name: 'اللغة الألمانية', level: 'المستوى الأول', price: '200000' },
        { name: 'اللغة اليابانية', price: '500000' },
        { name: 'اللغة التركية', price: '100000' },
        { name: 'دورة العمل المخبري', price: '100000' },
        { name: 'دورة الغيتار', price: '100000' },
        { name: 'دورة السكرتاريا', price: '100000' },
        { name: 'دورة تركيب و صيانة الطاقة الشمسية', note: '12 جلسة، تطبيق عملي', price: '500000' },
        { name: 'دورة الكهرباء المنزلية', note: '15 ساعة تدريبية', price: '500000' },
        { name: 'دورة التصوير الفوتوغرافي', price: '75000' },
        { name: 'دورة اللاش ليفتينغ', note: '10 ساعات تدريبية', price: '200000' },
        { name: 'دورة الريزن', price: '100000' },
        { name: 'دورة صناعة الشموع', price: '50000' },
        { name: 'دورة صناعة المنظفات (صناعة الصابون)', price: '50000' },
        { name: 'دورة الفوتوشوب', price: '50000' },
        { name: 'دورة الحساب الذهني', price: '100000' },
        { name: 'دورة TOT تدريب المدربين', price: '100000' },
        { name: 'دورة لغة الجسد', price: '100000' },
        { name: 'دورة إدارة الجودة', level: 'المستوى الأول', note: 'توقيت مسائي', price: '100000' },
        { name: 'دورة الأمين للمحاسبة', level: 'مبتدئ', price: '35000' },
        { name: 'دورة الأمين للمحاسبة', level: 'متقدم', price: '50000' },
        { name: 'دورة الأمين للمحاسبة', level: 'محترف', price: '75000' },
        { name: 'إعداد محاسب مالي', price: '100000' },
        { name: 'دورة الأمين تصنيع', note: 'يشترط حضور مستويي المبتدئ والمتقدم', price: '100000' },
        { name: 'دورة الأمين موارد بشرية', price: '100000' },
    ],
};

export const DAMASCUS_ONLINE_KEY = 'الدورة';

export const DAMASCUS_ONLINE_COURSES: {
    label: string;
    rows: (PriceRowFixture & { course: string })[];
} = {
    label: 'الدورات الأونلاين المتوفرة',
    rows: [
        { course: 'الأمين', name: 'دورة محاسبة الأمين أونلاين', price: '10', currency: 'دولار' },
        { course: 'الإكسل', name: 'دورة الإكسل المتقدم أونلاين', price: '10', currency: 'دولار' },
        { course: 'ICDL', name: 'دورة ICDL أونلاين', price: '10', currency: 'دولار' },
    ],
};

/**
 * One cohort SLOT per row. `start` forms:
 *   - 'YYYY-MM-DD'   → the merchant's real (now past) date, kept as-is: the row
 *                      is permanently expired and must NEVER reach the prompt.
 *   - { inDays: N }  → resolved against todayIso at seed/render time so the
 *                      fixture always holds upcoming cohorts.
 *   - null           → no announced date (تبدأ عند اكتمال العدد / open slot).
 */
export interface DamascusSlotFixture {
    /** Key value for «الدورة» — short, the way a customer names the course. */
    course: string;
    name: string;
    level?: string;
    days: string;
    time: string;
    note?: string;
    start: string | { inDays: number } | null;
}

export const DAMASCUS_SCHEDULES_LABEL = 'مواعيد الدورات المعلنة';
export const DAMASCUS_SCHEDULES_KEY = 'الدورة';

/**
 * KEY-VALUE CHOICE (binding guidance for the real-merchant extraction too):
 * matching is containment of the stored value inside the customer's message
 * (factCollectionsMatcher), so the key should be the SHORTEST unambiguous way
 * a customer names the course — an AL-less stem where safe: «مكياج» matches
 * both «المكياج» and «دورة مكياج»; «انكليزي» matches «الانكليزية» AND the
 * dialect «لانكليزي» (eval #550's real spelling, missed by the full form).
 * Do NOT shorten past unambiguity: «تركي» would false-match «تركيب», so
 * التركية keeps its full form (a miss under-answers — recoverable; a false
 * match shows another course's rows). ج/ك spelling variants («الانجليزية»)
 * still miss by design — the KB prose answers for itself and the coverage
 * line names every covered course, so a miss degrades to contact-us, never
 * to a fabricated schedule.
 */

export const DAMASCUS_SCHEDULE_SLOTS: DamascusSlotFixture[] = [
    // — upcoming cohorts (relative dates; day/time patterns are the real KB's) —
    { course: 'ICDL', name: 'دورة ICDL', days: 'الأحد والثلاثاء', time: '12-1', start: { inDays: 3 } },
    { course: 'ICDL', name: 'دورة ICDL', days: 'الأحد والثلاثاء', time: '1-2', start: { inDays: 5 } },
    { course: 'ICDL', name: 'دورة ICDL', days: 'الاثنين والأربعاء', time: '10-11', start: { inDays: 8 } },
    { course: 'ICDL', name: 'دورة ICDL', days: 'الاثنين والأربعاء', time: '5-6', start: { inDays: 12 } },
    { course: 'ICDL', name: 'دورة ICDL', days: 'الأحد والثلاثاء', time: '3-4', start: { inDays: 17 } },
    { course: 'الأمين', name: 'دورة الأمين للمحاسبة', level: 'مبتدئ', days: 'السبت فقط', time: '1-3', start: { inDays: 4 } },
    { course: 'الأمين', name: 'دورة الأمين للمحاسبة', level: 'مبتدئ', days: 'الأحد والثلاثاء', time: '7-8', start: { inDays: 9 } },
    { course: 'الأمين', name: 'دورة الأمين للمحاسبة', level: 'مبتدئ', days: 'الخميس فقط', time: '10-12', start: { inDays: 14 } },
    { course: 'الأمين', name: 'دورة الأمين للمحاسبة', level: 'مبتدئ', days: 'الخميس فقط', time: '4-6', start: { inDays: 18 } },
    { course: 'اسعافات', name: 'دورة الإسعافات الأولية', days: 'الاثنين والأربعاء', time: '4-5', start: { inDays: 2 } },
    { course: 'اسعافات', name: 'دورة الإسعافات الأولية', days: 'السبت والاثنين', time: '7-8', start: { inDays: 6 } },
    { course: 'اسعافات', name: 'دورة الإسعافات الأولية', days: 'الثلاثاء والخميس', time: '3-4:30', start: { inDays: 11 } },
    { course: 'اسعافات', name: 'دورة الإسعافات الأولية', days: 'السبت والاثنين', time: '9-10', start: { inDays: 16 } },
    { course: 'انكليزي', name: 'دورة اللغة الإنكليزية', level: 'مبتدئ', days: 'السبت والأربعاء', time: '12-1', start: { inDays: 5 } },
    { course: 'انكليزي', name: 'دورة اللغة الإنكليزية', level: 'مبتدئ', days: 'الاثنين والأربعاء', time: '3-4', start: { inDays: 10 } },
    { course: 'انكليزي', name: 'دورة اللغة الإنكليزية', level: 'مبتدئ', days: 'الأحد والثلاثاء', time: '9-10', start: { inDays: 15 } },
    { course: 'انكليزي', name: 'دورة اللغة الإنكليزية', level: 'مبتدئ', days: 'الأحد والثلاثاء', time: '5-6', start: { inDays: 20 } },
    { course: 'انكليزي', name: 'دورة اللغة الإنكليزية', level: 'متوسط 1', days: 'الأحد والثلاثاء', time: '10-11', start: { inDays: 6 } },
    { course: 'انكليزي', name: 'دورة اللغة الإنكليزية', level: 'متوسط 1', days: 'السبت فقط', time: '2-4', start: { inDays: 13 } },
    { course: 'انكليزي', name: 'دورة اللغة الإنكليزية', level: 'متوسط 2', days: 'السبت فقط', time: '1-2', start: { inDays: 7 } },
    { course: 'انكليزي', name: 'دورة اللغة الإنكليزية', level: 'متوسط 2', days: 'الأربعاء فقط', time: '3-4', start: { inDays: 9 } },
    { course: 'انكليزي', name: 'دورة اللغة الإنكليزية', level: 'متوسط 2', days: 'الأحد والثلاثاء', time: '11-12', start: { inDays: 19 } },

    // — the merchant's real dates, all past: permanently expired, must be
    //   SUPPRESSED (the stale-date class — never quoted as upcoming) —
    { course: 'مكياج', name: 'دورة المكياج او التجميل', level: 'مبتدئ', days: 'الخميس فقط', time: '12-2', start: '2026-06-25' },
    { course: 'مكياج', name: 'دورة المكياج او التجميل', level: 'مبتدئ', days: 'السبت فقط', time: '10-12', start: '2026-07-04' },
    { course: 'مكياج', name: 'دورة المكياج او التجميل', level: 'مبتدئ', days: 'الأحد فقط', time: '3-5', start: '2026-07-05' },
    { course: 'مكياج', name: 'دورة المكياج او التجميل', level: 'مبتدئ', days: 'الاثنين والأربعاء', time: '4-5', start: '2026-07-06' },
    { course: 'الأظافر', name: 'دورة الأظافر', level: 'مبتدئ', days: 'السبت فقط', time: '12-2', start: '2026-06-27' },
    { course: 'اللاش ليفتينغ', name: 'دورة اللاش ليفتينغ', days: 'السبت فقط', time: '4-6', start: '2026-07-04' },
    { course: 'العناية بالبشرة', name: 'دورة العناية بالبشرة', days: 'الأحد والثلاثاء', time: '12-2', start: '2026-07-04' },
    { course: 'الحلاقة النسائية', name: 'دورة الحلاقة النسائية', level: 'مبتدئ', days: 'السبت والاثنين', time: '9-10:30', start: '2026-07-04' },
    { course: 'الحلاقة النسائية', name: 'دورة الحلاقة النسائية', level: 'مبتدئ', days: 'السبت فقط', time: '4-5:30', start: '2026-06-27' },
    { course: 'الحلاقة الرجالية', name: 'دورة الحلاقة الرجالية', level: 'مبتدئ', days: 'السبت فقط', time: '10-12', start: '2026-06-27' },
    { course: 'الحلاقة الرجالية', name: 'دورة الحلاقة الرجالية', level: 'مبتدئ', days: 'الأحد والثلاثاء', time: '5-7', start: '2026-07-05' },
    { course: 'التركية', name: 'دورة اللغة التركية', days: 'الاثنين والأربعاء', time: '6-8', start: '2026-07-24' },
    { course: 'الألمانية', name: 'دورة اللغة الألمانية', level: 'المستوى الأول', days: 'الأحد والثلاثاء', time: '9-11', start: '2026-07-05' },
    { course: 'الألمانية', name: 'دورة اللغة الألمانية', level: 'المستوى الأول', days: 'الاثنين والأربعاء', time: '5-7', start: '2026-07-06' },
    { course: 'لغة الجسد', name: 'دورة لغة الجسد', days: 'الأحد والثلاثاء', time: '5-6', start: '2026-07-05' },
    { course: 'السكرتاريا', name: 'دورة السكرتاريا', days: 'الخميس فقط', time: '2-4', start: '2026-07-02' },
    { course: 'التصوير', name: 'دورة التصوير الفوتوغرافي', days: 'الخميس فقط', time: '2-4', start: '2026-07-02' },
    { course: 'التصوير', name: 'دورة التصوير الفوتوغرافي', days: 'الأحد والثلاثاء', time: '4-6', start: '2026-06-28' },
    { course: 'صناعة المنظفات', name: 'دورة صناعة المنظفات', days: 'السبت فقط', time: '2-4', start: '2026-07-04' },
    { course: 'الفوتوشوب', name: 'دورة الفوتوشوب', days: 'الخميس فقط', time: '6-8', start: '2026-07-05' },
    { course: 'إدخال البيانات', name: 'دورة إدخال البيانات', days: 'السبت فقط', time: '12-2', start: '2026-07-04' },
    { course: 'محاسب مالي', name: 'دورة إعداد محاسب مالي', days: 'الخميس فقط', time: '2-4', start: '2026-07-09' },
    { course: 'الغيتار', name: 'دورة الغيتار', days: 'السبت فقط', time: '2-4', start: '2026-07-04' },
    { course: 'العمل المخبري', name: 'دورة العمل المخبري', days: 'الاثنين والأربعاء', time: '5-6', start: '2026-07-08' },
    { course: 'TOT', name: 'دورة TOT تدريب المدربين', days: 'الاثنين فقط', time: '5-7', start: '2026-07-06' },

    // — no announced date: never expires, honest «عند اكتمال العدد» —
    { course: 'الهولندية', name: 'دورة اللغة الهولندية', days: 'الأحد والثلاثاء', time: '11-1', note: 'تبدأ عند اكتمال العدد', start: null },
    { course: 'اليابانية', name: 'دورة اللغة اليابانية', days: 'الخميس فقط', time: '1-3', note: 'تبدأ عند اكتمال العدد', start: null },
    { course: 'الحساب الذهني', name: 'دورة الحساب الذهني', days: 'الأحد والثلاثاء', time: '4-6', note: 'تبدأ عند اكتمال العدد', start: null },
    { course: 'موارد بشرية', name: 'دورة الأمين موارد بشرية', days: 'الأربعاء', time: '4-6', note: 'تبدأ عند اكتمال العدد', start: null },
    { course: 'الإكسل', name: 'دورة الإكسل المتقدم', days: 'الأحد والثلاثاء', time: '2-3', start: null },
    { course: 'الإكسل', name: 'دورة الإكسل المتقدم', days: 'الأحد والثلاثاء', time: '6-7', start: null },
];

/** A cohort listing self-expires the day AFTER its start (endsAt = startsAt is
 *  live while `endsAt >= today`): still announceable on the day it begins,
 *  gone as "upcoming" from then on — the v38 stale-date class, killed by data. */
export function resolveSlotDates(
    start: DamascusSlotFixture['start'],
    todayIso: string,
): { startsAt: string | null; endsAt: string | null } {
    if (start === null) return { startsAt: null, endsAt: null };
    if (typeof start === 'string') return { startsAt: start, endsAt: start };
    const d = new Date(`${todayIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + start.inDays);
    const iso = d.toISOString().slice(0, 10);
    return { startsAt: iso, endsAt: iso };
}

function priceRowAttributes(r: PriceRowFixture): { label: string; value: string }[] | null {
    const attrs: { label: string; value: string }[] = [];
    if (r.course) attrs.push({ label: DAMASCUS_ONLINE_KEY, value: r.course });
    if (r.level) attrs.push({ label: 'المستوى', value: r.level });
    if (r.note) attrs.push({ label: 'ملاحظة', value: r.note });
    return attrs.length ? attrs : null;
}

function slotRowAttributes(s: DamascusSlotFixture): { label: string; value: string }[] {
    const attrs: { label: string; value: string }[] = [
        { label: DAMASCUS_SCHEDULES_KEY, value: s.course },
    ];
    if (s.level) attrs.push({ label: 'المستوى', value: s.level });
    attrs.push({ label: 'الأيام', value: s.days });
    attrs.push({ label: 'الساعة', value: s.time });
    if (s.note) attrs.push({ label: 'ملاحظة', value: s.note });
    return attrs;
}

/** Row inputs in the shape `factCollectionsService.createCollection` takes —
 *  shared by the seeder and the offline renderer so the DB rows and the
 *  scripts' grounding text can never drift apart. */
export function damascusPriceRowInputs(fixture: { rows: PriceRowFixture[] }): Array<{
    name: string;
    attributes: { label: string; value: string }[] | null;
    price: string;
    currency: string;
}> {
    return fixture.rows.map(r => ({
        name: r.name,
        attributes: priceRowAttributes(r),
        price: r.price,
        currency: r.currency ?? DAMASCUS_OLD_SYP,
    }));
}

export function damascusScheduleRowInputs(todayIso: string): Array<{
    name: string;
    attributes: { label: string; value: string }[];
    startsAt: string | null;
    endsAt: string | null;
}> {
    return DAMASCUS_SCHEDULE_SLOTS.map(s => ({
        name: s.name,
        attributes: slotRowAttributes(s),
        ...resolveSlotDates(s.start, todayIso),
    }));
}

/**
 * The damascus page's <business_lists> text for offline harnesses
 * (grounding-audit / probe batteries) — same contract as
 * renderDemoDistributorLists: MUST render exactly what the live service
 * assembles, or the verifier judges replies against a source the generator
 * never saw.
 */
export function renderDemoDamascusLists(
    todayIso: string,
    opts?: {
        /** A/B instrument only: render the schedules collection UN-KEYED (no
         *  course index, every live row always shown) so an un-keyed arm's
         *  grounding matches what its generator actually saw. The shipped
         *  default is keyed — see the collection note above. */
        schedulesUnkeyed?: boolean;
    },
): string {
    const toPromptRow = (r: {
        name: string;
        attributes?: { label: string; value: string }[] | null;
        price?: string | null;
        currency?: string | null;
        startsAt?: string | null;
        endsAt?: string | null;
    }): FactRowForPrompt => ({
        name: r.name,
        attributes: r.attributes ?? null,
        price: r.price ?? null,
        currency: r.currency ?? null,
        startsAt: r.startsAt ?? null,
        endsAt: r.endsAt ?? null,
        isAvailable: true,
    });

    const blocks = [
        renderFactCollectionBlock(
            // isComplete stays null — the fixture never claims completeness (D-038).
            { label: DAMASCUS_COURSE_PRICES.label, keyAttr: null, isComplete: null },
            damascusPriceRowInputs(DAMASCUS_COURSE_PRICES).map(toPromptRow),
            todayIso,
        ),
        renderFactCollectionBlock(
            { label: DAMASCUS_SCHEDULES_LABEL, keyAttr: opts?.schedulesUnkeyed ? null : DAMASCUS_SCHEDULES_KEY, isComplete: null },
            damascusScheduleRowInputs(todayIso).map(toPromptRow),
            todayIso,
        ),
        renderFactCollectionBlock(
            { label: DAMASCUS_ONLINE_COURSES.label, keyAttr: DAMASCUS_ONLINE_KEY, isComplete: null },
            damascusPriceRowInputs(DAMASCUS_ONLINE_COURSES).map(toPromptRow),
            todayIso,
        ),
    ];
    return blocks.filter((b): b is string => !!b).join('\n\n');
}
