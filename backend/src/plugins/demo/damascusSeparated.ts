/**
 * Demo fixture, arm B1 — الفريق الدمشقي with the four data kinds SEPARATED
 * (plan §5 item 5): entity facts on rows, page facts in prose, the merchant's
 * standing ORDERS in a directives list, and — deliberately untouched — his
 * GENERAL RULES, the fourth kind (§2-ب).
 *
 * Selected at seed time by DEMO_DAMASCUS_FIXTURE=separated (seedData.ts);
 * the shipped default stays the 'current' shape, byte-identical to
 * DAMASCUS_DEMO_KB, so arm A and production behaviour never move.
 *
 * SURGERY, NOT A SECOND COPY
 * --------------------------
 * The separated KB is DERIVED from DAMASCUS_DEMO_KB by exact-match removals
 * that THROW unless the marker occurs exactly once. A hand-maintained second
 * ~5k-char constant would drift from the first silently; a regex would fail
 * silently (the `regexp_replace` `\n` trap already burned one isolation arm,
 * 2026-08-05). If the prose changes upstream, the derivation breaks loudly in
 * unit tests instead of measuring a fixture nobody intended.
 *
 * WHAT MOVES, AND WHY EXACTLY THIS
 * --------------------------------
 * • THREE محاور blocks → the «محاور الدورات» collection, one محور per row. The prose keeps a
 *   LIST-ANCHORED line in each block's place — the عين زارة/جلسات lesson,
 *   twice measured: deleting prose that carries an answer's SHAPE produces a
 *   BORROWED wrong answer (12 جلسة from the solar row), not silence.
 * • The guitar AND laptop Q&As BOTH STAY in prose. The guitar one was moved to a
 *   row attribute and measured WORSE (see the ⛔ block in the derivation below):
 *   it states a page-level policy, and forcing a page fact onto one entity is
 *   the attribute-boundary trap (§2-ب, ⛔ three designs died there).
 * • FOUR routing Q&As → two directives (below). «الشهادة من وين بتطلع» keeps
 *   its prose routing — a «شهادة» trigger would swallow the certificate-FEE
 *   questions the prose answers itself.
 * • GENERAL RULES stay in prose, verbatim: «معظم الدورات ٨ ساعات تدريبية…»,
 *   «مدة كل مستوى … شهر», «كافة الاعمار مقبولة», «الدروس تقام في المعهد».
 *   They are a LEGITIMATE source for entity answers (٨ ساعات ÷ ساعة/يوم =
 *   ٨ جلسات — the owner's correction, measured 2026-08-05); no check may
 *   deny them and no cleanup may remove them.
 */
import type { MerchantDirective } from '@jawab24/shared';
import { DAMASCUS_DEMO_KB } from './damascusKb';

/**
 * The merchant's standing orders, in his own words (the response text is his
 * production phrasing; the numbers are the ones his prose repeats four times).
 *
 * Trigger scopes are deliberately NARROW — the keyword router's own bias:
 * a silent false positive routes an ANSWERABLE question away (his lab course
 * has a price row; «مخبر» as a trigger would swallow «قديش سعر دورة العمل
 * المخبري»), which is worse than a miss that degrades to the model + rows.
 */
export const DAMASCUS_DIRECTIVES: MerchantDirective[] = [
    {
        keywords: 'تحليلات, سحب الدم, مشافي, وزارة الصحة',
        response: 'ارجو التواصل على أرقامنا مباشرة: 0935924472 - 0112124472 - 0937549674',
    },
    {
        keywords: 'التحويل من دورة, تحويل من دورة',
        response: 'للتحويل من دورة إلى أخرى الرجاء التواصل على أرقامنا: 0935924472 - 0112124472 - 0937549674',
    },
];

/** Exact-match replace that throws unless `marker` occurs exactly once — the
 *  loud-failure contract described in the module header. */
function replaceOnce(text: string, marker: string, replacement: string): string {
    const first = text.indexOf(marker);
    if (first === -1) {
        throw new Error(`damascusSeparated: marker not found (prose changed upstream?): ${marker.slice(0, 60)}…`);
    }
    if (text.indexOf(marker, first + 1) !== -1) {
        throw new Error(`damascusSeparated: marker is not unique: ${marker.slice(0, 60)}…`);
    }
    return text.slice(0, first) + replacement + text.slice(first + marker.length);
}

/** The B1 prose: DAMASCUS_DEMO_KB minus exactly what moved to rows/directives. */
export function deriveSeparatedDamascusKb(): string {
    let kb = DAMASCUS_DEMO_KB;

    // — محاور → «المحاور» row attributes, each block replaced by a list anchor —
    kb = replaceOnce(
        kb,
        'محاور دورة العناية بالبشرة:\nانواع البشرة\nانواع الماسكات\nاستخدام البخار\nتنظيف البشرة العميق\nحب الشباب\nالديرمابن وعلاج البشرة\nانواع الميزوثيرابي\nالروتين اليومي للعناية بالبشرة\nتطبيق عملي',
        'محاور دورة العناية بالبشرة مفصّلة في قائمة محاور الدورات.',
    );
    kb = replaceOnce(
        kb,
        'محاور دورة رفع الرموش و الحواجب :\n النظري :\n\n١) مقدمة عن رفع الرموش والحواجب\n\n٢) فهم دورة نمو الرموش الطبيعية\n\n٣) معرفة المواد والادوات اللازمة لرفع الرموش وتثبيتها .\n\n العملي :\n\n١)تحضير الرموش قبل البدء بالعمل\n\n٢) تقنيات تطبيق مواد الرفع والتثبيت\n\n٣) اختيار احجام السيليكون\n\n٤) ازالة الرموش والتعامل مع المشكلات في حال حدوث اي خطأ .',
        'محاور دورة رفع الرموش و الحواجب مفصّلة في قائمة محاور الدورات.',
    );
    kb = replaceOnce(
        kb,
        'محاور الدورة:\nـ مفهوم الجودة وإدارة الجودة\nـ رواد الجودة\nـ مفاهيم أساسية ضبط وتأكيد الجودة وإدارة الجودة الشاملة\nـ ادوات الجودة\n ـ مقاييس الجودة\nـ تكاليف  الجودة',
        'محاور الدورة مفصّلة في قائمة محاور الدورات.',
    );

    // ⛔ THE GUITAR Q&A STAYS IN PROSE — measured 2026-08-05, arm B1 vs A.
    // It was moved to an «الأدوات» row attribute and DELETED from the prose. The
    // result was a confident FABRICATION on a question it had previously handled
    // honestly:
    //   «دورة الميكاب لازم جيب ادواتي معي؟»
    //     arm A  → «ما في ذكر محدد… يُفضل التواصل معنا»            (honest, flagged)
    //     arm B1 → «لا، ما لازم تجيب أدواتك، المعهد يوفر الأدوات»  (invented, UNflagged)
    // The sentence carries an answer SHAPE — "the institute does not supply the
    // kit; the student brings their own" — that generalises across courses, and
    // it is the third time deleting such prose produced a BORROWED/INVERTED
    // answer rather than silence (عين زارة, the 12-جلسة solar row, now this).
    // It is also a page-level policy, not an entity fact, so forcing it onto one
    // row was the attribute-boundary trap in miniature.

    // — routing Q&As → DAMASCUS_DIRECTIVES. The certificate-origin question keeps
    //   its prose routing (see module header for why «شهادة» must not be a trigger).
    kb = replaceOnce(
        kb,
        'Q: الشهادة من وين بتطلع\nQ:تحت اشراف وزارة الصحة؟\nQ:وفي تعليم لسحب الدم؟\nQ: وبتعلمو تحليلات جوا بالمخبر ؟\nA: ارجو التواصل على أرقامنا',
        'Q: الشهادة من وين بتطلع\nA: ارجو التواصل على أرقامنا',
    );
    kb = replaceOnce(
        kb,
        'Q:  هل يوجد تدريب بالمشافي\nA:  ياريت تتواصل معنا على ارقامنا مباشرة\n\n',
        '',
    );
    kb = replaceOnce(
        kb,
        'Q: هل يمكن التحويل من دورة إلى أخرى\nA: الرجاء التواصل على ارقامنا\n\n',
        '',
    );

    return kb;
}
