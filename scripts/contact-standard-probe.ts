/**
 * Contact-standard A/B probe — try the change on a real merchant's shape
 * BEFORE merging it.
 *
 * The question the owner actually needs answered is two questions, and they
 * deserve different instruments:
 *
 *   1. "Does this break the replies my merchants get today?"
 *      Answered DETERMINISTICALLY. What reaches the model is the BUSINESS_INFO
 *      block, and building it is a pure function — so this renders each
 *      merchant's CURRENT configuration through BOTH formatters (the one on
 *      origin/main and the one on this branch) in one process and diffs the
 *      bytes. No sampling, no LLM variance: if the bytes match, the model's
 *      input is identical and the reply cannot have changed for that merchant.
 *
 *      This is why a second running server is not needed for the safety half.
 *      Two servers would re-measure, with noise, something a string comparison
 *      settles exactly. (If you still want the two-server arm — e.g. to
 *      exercise the HTTP layer — see the recipe at the bottom of this file.)
 *
 *   2. "Does it actually help?"
 *      Answered by MEASUREMENT, because it depends on the model. The same real
 *      customer questions run against the same page twice: once with the
 *      merchant's data as it stands today, once with it migrated to the
 *      standard. Both arms run on this branch, so the only variable is the
 *      DATA — which is the thing the merchant would actually change.
 *
 * Scenarios are the two merchants this work came from, with their REAL data:
 * MES's contaminated `phones` field plus the four routing rules in his persona,
 * and Shahin's routing table inside a persona that is at 800/800 chars and
 * truncated mid-word. The questions are REAL customer messages harvested from
 * each page's own production inbox — not invented ones, because the thing being
 * proved is that the merchant's improvisations can be DELETED without any
 * customer noticing, and only their own customers' questions can show that.
 *
 * Each merchant has a dedicated probe page (`mes-eval-probe`, `shahin-eval-probe`)
 * carrying their real knowledge base, so no scenario has to override it.
 *
 * Run:
 *   ADMIN_TOKEN=<jwt> BASE_URL=http://localhost:3220 \
 *   PROBE_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/autoreply_eval_email \
 *   PROBE_RUNS=5 PROBE_TRANSCRIPT=/tmp/probe.md \
 *   npx tsx scripts/contact-standard-probe.ts
 *
 * ⚠️ `PROBE_RUNS=1` answers question 2 with a single draw from a distribution.
 * Use ≥ 5 for anything that will be reported, and read the FLIP RATE, not the
 * score — see the `RUNS` constant.
 *
 * Read-only against production by construction: it writes ONLY to the page it
 * is pointed at in a LOCAL database, and restores that page's original profile
 * when it finishes.
 */

import { appendFileSync, writeFileSync } from 'fs';
import postgres from 'postgres';
import { formatBusinessInfoPrompt } from '../packages/shared/src/businessInfoPrompt';
import type { BusinessProfile } from '../packages/shared/src/index';
import type { MerchantProvenanceMap } from '../packages/shared/src/businessProfileMerge';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3220';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATABASE_URL = process.env.PROBE_DATABASE_URL
    || 'postgresql://postgres:postgres@localhost:5433/autoreply_eval_email';

/**
 * How many times each arm's question set is asked (`PROBE_RUNS`, default 1).
 *
 * ⭐ One run cannot distinguish an arm difference from model sampling. The
 * probe's own history is the argument: the arm ORDERING has reproduced across
 * repeats while the per-arm COUNTS have not, so any single-run "+1" is a claim
 * about one draw. Runs are genuinely independent — the eval pipeline bypasses
 * every cache in both directions (see `clearReplyCache` below for the exact
 * mechanism), so nothing replays a previous run's answer.
 */
const RUNS = Math.max(1, Number(process.env.PROBE_RUNS ?? 1));

/**
 * Where every reply of every run is written (`PROBE_TRANSCRIPT`, optional).
 *
 * stdout stays readable by printing only failing and unstable cells; the file is
 * what makes a verdict auditable afterwards, which matters because a "FAIL" here
 * has already turned out to be a grader gap rather than a bad reply.
 */
const TRANSCRIPT = process.env.PROBE_TRANSCRIPT || '';

/**
 * Substring filter on `Scenario.key` (`PROBE_SCENARIO`, optional).
 *
 * Exists so a fixture correction to ONE merchant can be re-measured without
 * re-spending the other's 200 model calls — and so the two are never silently
 * blended: a scenario left out is reported as skipped, never as unchanged.
 */
const SCENARIO_FILTER = process.env.PROBE_SCENARIO || '';

/** Scenarios this invocation covers. Declared once so both halves of the probe
 *  agree on what was measured. */
const selected = (): Scenario[] =>
    SCENARIOS.filter((s) => !SCENARIO_FILTER || s.key.includes(SCENARIO_FILTER));

/**
 * Every question must have an expectation, checked at load.
 *
 * Adding a question without an expectation shifts every later one onto the wrong
 * assertion — a scenario that still prints a plausible score while grading the
 * wrong things. Cheaper to refuse to start.
 */
function assertScenariosWellFormed(): void {
    for (const s of SCENARIOS) {
        if (s.expect.length !== s.questions.length) {
            throw new Error(
                `scenario «${s.key}»: ${s.questions.length} questions but ${s.expect.length} expectations`,
            );
        }
    }
}

/**
 * origin/main's formatter, dropped in beside ours so both can be imported into
 * one process. Created by the runner:
 *   git show origin/main:packages/shared/src/businessInfoPrompt.ts \
 *     > packages/shared/src/__mainBusinessInfoPrompt.ts
 * Absent → the deterministic half is skipped with a loud notice rather than
 * silently reporting "no change".
 */
const MAIN_FORMATTER_PATH = '../packages/shared/src/__mainBusinessInfoPrompt';

interface Scenario {
    key: string;
    merchant: string;
    /**
     * The page's knowledge base for this scenario.
     *
     * ⚠️ Load-bearing, learned the hard way on the first run: overriding only
     * `business_profile` left the carrier page's ELECTRONICS knowledge base in
     * place while the persona described a resort. The model answered «معك سارة
     * من تقنيات الشام للأجهزة الكهربائية» to «بدي احجز غرفة» and the arms both
     * "failed" — a defect of the instrument, not of either arm. A probe whose
     * fixture contradicts itself measures nothing; swap the whole page identity
     * or do not run the scenario.
     */
    knowledgeBase?: string;
    /**
     * The probe page carrying this merchant's REAL knowledge base, by
     * `facebook_page_id`. Each merchant has their own (`mes-eval-probe`,
     * `shahin-eval-probe`), which is why `knowledgeBase` above is now OPTIONAL:
     * the page already holds the merchant's own prose, so overriding it would
     * replace the very thing under test. Set it only to model a KB edit.
     */
    pageKey: string;
    /** What the merchant has TODAY, verbatim in shape. */
    today: Arm;
    /** The same business expressed through the contact standard. */
    standard: Arm;
    /**
     * Extra arms beyond TODAY and STANDARD, run on the same questions.
     *
     * They exist because the strict STANDARD arm showed the two jobs a persona
     * rule can do come apart. «0993301022 الادارة» is a label and the structured
     * description replaces it exactly; «رقم الادارة لا يرسل إلا عند طلبه» is a
     * visibility policy that schema.org ContactPoint has no property for. Each
     * variant is one candidate home for that second kind.
     */
    variants?: NamedArm[];
    questions: string[];
    /** What a good reply must and must not contain, per question index. */
    expect: { must?: string[]; mustNot?: string[] }[];
}

/** An arm plus the label it is reported under. Names are padded to one width so
 *  the per-question verdict columns line up when read in a terminal. */
interface NamedArm {
    name: string;
    cfg: Arm;
}

interface Arm {
    profile: BusinessProfile;
    provenance?: MerchantProvenanceMap;
    persona: string;
    /**
     * Fact-collection labels this arm keeps. Any collection on the page NOT
     * listed here is removed for the arm's duration and restored afterwards.
     *
     * This is what makes the entity-ownership ruling testable rather than
     * asserted: a phone belonging to the PAGE (a department) becomes a contact
     * point, while a phone belonging to ANOTHER ENTITY (a showroom, which has
     * its own address) stays a row on that entity. So «صالات الشركة» is listed
     * in BOTH arms and «أرقام الأقسام» only in `today` — and the questions below
     * then prove whether deleting it costs a customer anything.
     *
     * `undefined` = keep every collection (the arm changes nothing).
     */
    keepCollections?: string[];
    /**
     * KB lines to REMOVE for this arm — any line containing one of these
     * substrings is dropped.
     *
     * ⚠️ Without this the probe cannot attribute anything. Both merchants keep a
     * THIRD copy of their routing table in the knowledge base, verbatim
     * («للشكاوي : 0931671111», «✦ قواعد:»), so a STANDARD arm that cleaned only
     * the persona still had every number-to-purpose mapping in front of the
     * model. It answered correctly — and proved nothing, because the KB copy
     * alone could have carried it. Stripping here is what leaves the structured
     * descriptions as the ONLY remaining source.
     *
     * Genuine POLICY lines stay (no social-media booking, no Sham Cash): they
     * are not contact data and have a legitimate home in the persona.
     */
    stripFromKb?: string[];
    /**
     * In-place KB edits for this arm — `from` → `to`, substring, whole document.
     *
     * Separate from `stripFromKb` because isolating a variable sometimes means
     * CORRECTING a line rather than deleting it. The TYPO-ONLY arm below is the
     * case that earned it: the merchant's «إلى»/«إلا» slip lives in his persona
     * AND in his KB, so an arm that fixes it in only one place measures a
     * document that contradicts itself.
     *
     * ⚠️ `from` must be long enough to be unique — a bare «إلى» is the Arabic
     * preposition "to" and appears throughout legitimate prose.
     */
    rewriteKb?: Array<{ from: string; to: string }>;
}

const CONFIRMED: MerchantProvenanceMap = {
    phones: { source: 'editor', confirmedAt: '2026-08-01T00:00:00.000Z' },
    email: { source: 'editor', confirmedAt: '2026-08-01T00:00:00.000Z' },
};

/**
 * MES's persona — the ARABIC variant, verbatim from production
 * (`settings.brand_voice_notes_multi.ar`, `sourceLang: 'ar'`).
 *
 * ⚠️ It must be the Arabic one. `resolveBrandVoiceNotes` selects the variant by
 * the CUSTOMER's detected language, and every question below is Arabic, so
 * production serves `ar`. An earlier run of this probe injected the English
 * translation instead and measured a persona no Arabic customer ever sees.
 *
 * The first five lines are identity and tone — what the field is for. The last
 * four are ROUTING POLICY that had nowhere else to live.
 *
 * ⭐ Line 7 contains a merchant TYPO that inverts his own rule: «لا يرسل **إلى**
 * في حالة طلب» is «إلا» (except) mistyped as «إلى» (to). He meant "the
 * management number is sent ONLY when management or complaints is asked for";
 * as written it reads as a flat refusal. The English translation then baked the
 * broken reading in («is not sent if … is requested»). Kept verbatim — the
 * point of a TODAY arm is what the merchant actually has, typo included.
 */
const MES_PERSONA_TODAY = `الاسم: معك رنيم من شركة ام اي اس
النبرة واللهجة:  ودود، لهجة سورية
عبارات مميّزة: بعض العبارات مع إيموجي
أسلوب الرد: قصير، إيموجي خفيف، يبدو بشري — بدون ردود جافة
الهدف:  الاسم والجوال - التوجيه إلى الصالات حسب المدينة
عند طلب ارقام هواتف ترسل ارقام الصالات فقط
رقم الادارة لا يرسل إلى في حالة طلب رقم الادارة  والشكاوي
رقم مبيعات الجملة  لا يرسل إلا عند طلب مبيعات الجملة او مبيعات التجار
لا تقترح ارقام قسم مبيعات الجملة إلا إذا طلب منك قسم مبيعات الجملة`;

/**
 * The merchant's «إلى» → «إلا» slip, as an anchored rewrite.
 *
 * ⭐ Long enough to be unique on purpose: «إلى» alone is the preposition "to"
 * and occurs throughout both his persona and his KB. Verified once against each
 * fixture (one match in the persona, one in the 127-line KB); `transformKb`
 * asserts the match still exists rather than trusting it.
 *
 * The SAME pair is applied to both documents, because he wrote the rule in both
 * and a merchant fixing his own typo would fix it where he wrote it.
 */
const MES_TYPO_FIX = {
    from: 'رقم الادارة لا يرسل إلى في حالة',
    to: 'رقم الادارة لا يرسل إلا في حالة',
};

/**
 * TODAY's persona with ONLY the typo corrected — everything else byte-identical,
 * including the fourth redundant rule and the double space HYBRID tidies up.
 *
 * Derived rather than copied: a second 405-char literal would drift silently
 * from the TODAY arm it is supposed to differ from in exactly one character
 * (Rule 10.8). The assertion below is what makes the derivation trustworthy —
 * a rewrite that matched nothing would make this arm a duplicate of TODAY and
 * "prove" the typo costs nothing.
 */
const MES_PERSONA_TYPO_FIXED = MES_PERSONA_TODAY.replace(MES_TYPO_FIX.from, MES_TYPO_FIX.to);
if (MES_PERSONA_TYPO_FIXED === MES_PERSONA_TODAY) {
    throw new Error('TYPO-ONLY arm is inert: the typo anchor no longer matches MES_PERSONA_TODAY.');
}

/** The same persona with the four routing lines DELETED — identity, tone and
 *  goal only. This is the cleanup the standard is supposed to make safe, and it
 *  also disposes of the inverted-rule typo without anyone having to spot it. */
const MES_PERSONA_STANDARD = `الاسم: معك رنيم من شركة ام اي اس
النبرة واللهجة:  ودود، لهجة سورية
عبارات مميّزة: بعض العبارات مع إيموجي
أسلوب الرد: قصير، إيموجي خفيف، يبدو بشري — بدون ردود جافة
الهدف:  الاسم والجوال - التوجيه إلى الصالات حسب المدينة`;

/**
 * The HYBRID persona: identity and tone, plus the merchant's rules that are
 * genuinely POLICY rather than labelling.
 *
 * What is kept, and why each one cannot become a contact description:
 *   1. generic phone request → showrooms first. A PRIORITY between numbers.
 *      schema.org has no such property; Google Business Profile expresses the
 *      same idea as "primary + additional".
 *   2/3. management and wholesale lines are given only when asked for by name.
 *      A VISIBILITY rule — the standard has no way to say "exists, but do not
 *      volunteer".
 *
 * ⭐ Rule 2 is written here with «إلا», FIXING the merchant's «إلى» typo. Kept
 * verbatim in the TODAY arm (that is what he has), corrected here (that is what
 * he meant) — so this arm measures his intent, not his slip. His fourth rule is
 * dropped as a restatement of the third.
 */
const MES_PERSONA_HYBRID = `الاسم: معك رنيم من شركة ام اي اس
النبرة واللهجة:  ودود، لهجة سورية
عبارات مميّزة: بعض العبارات مع إيموجي
أسلوب الرد: قصير، إيموجي خفيف، يبدو بشري — بدون ردود جافة
الهدف:  الاسم والجوال - التوجيه إلى الصالات حسب المدينة
عند طلب ارقام هواتف ترسل ارقام الصالات فقط
رقم الادارة لا يرسل إلا في حالة طلب رقم الادارة او الشكاوي
رقم مبيعات الجملة لا يرسل إلا عند طلب مبيعات الجملة او مبيعات التجار`;

/**
 * Shahin's persona — the ARABIC source (`brand_voice_notes_multi.ar`,
 * `sourceLang: 'ar'`, 710 chars), which is what Arabic customers get.
 *
 * ⭐ Worth knowing when reading the field's 800-char cap: his EN translation is
 * exactly 800/800 and TRUNCATED mid-word — it ends «The resort's landline nu»,
 * losing both the landline and the email that the Arabic below still carries.
 * So the cap is already destroying content for this merchant, just not on the
 * variant most of his customers see. Six contact lines in an identity field is
 * what pushes it there.
 */
const SHAHIN_PERSONA_TODAY = `سارة , لهجة سورية ودودة , لاتقوم باعطاء أجوبة خارج نطاق المنتجع
التزم بالقواعد التالية :
لحجوزات الغرف والأجنحة والشقق الفندقية والمكاتب السياحية والمجموعات السياحية المرخصة ومعرفة الأسعار وتثبيت الحجز التواصل 0982414141
لتثبيت الحجز حصرا التواصل هاتفيا عبر 0189955 أو 0982414141 , لايوجد لدينا تثبيت حجز عن طريق وسائل التواصل الجتماعي
حاليا لايوجد دفع عن طريق شام كاش
لمعرفة الحجوزات المتاحة حصرا  الاتصال على قسم الحجوزات
خدمات المسبح (pool) من حجوزات خاصة للجاكوزي وغيرها من الخدمات الاتصال على : 0995008336
للشكاوي : 0931671111
ولدينا صالة أعراس للاستفسار :098996402
ولدينا صالة مؤتمرات للاستفسار : 0982414141
الرقم الأرضي الرباعي الخاص بالمنتجع : 0189955
الايميل الخاص بالمنتجع : sales@shahinresort.com`;

/** Identity plus the two genuine POLICIES that are not contact routing (no
 *  booking confirmation over social media; no Sham Cash). Every «contact X for
 *  Y» line is gone — that is data now. 208 chars instead of 710, and the EN
 *  translation no longer hits the cap. */
const SHAHIN_PERSONA_STANDARD = `سارة , لهجة سورية ودودة , لاتقوم باعطاء أجوبة خارج نطاق المنتجع
لايوجد لدينا تثبيت حجز عن طريق وسائل التواصل الاجتماعي
حاليا لايوجد دفع عن طريق شام كاش`;

/**
 * Shahin's KB copy of the same routing table his persona carries, line by line.
 *
 * Shared by every arm that moves labels into the structured field, so the two
 * mappings under test (STANDARD and FLAT-LBL) differ in exactly ONE description
 * and nothing else — a second copy of this list would let them drift and quietly
 * turn a one-variable comparison into a two-variable one.
 */
const SHAHIN_KB_CONTACT_LINES = [
    'لحجوزات الغرف والأجنحة والشقق الفندقية والمكاتب السياحية',
    'لتثبيت الحجز حصرا التواصل هاتفيا عبر',
    'لمعرفة الحجوزات المتاحة حصرا',
    'خدمات المسبح (pool) من حجوزات خاصة للجاكوزي',
    'للشكاوي : 0931671111',
    'ولدينا صالة أعراس للاستفسار',
    'ولدينا صالة مؤتمرات للاستفسار',
    'الرقم الأرضي الرباعي الخاص بالمنتجع',
    'الايميل الخاص بالمنتجع',
];

/** Never acceptable in a customer reply, on any question, in any arm. */
const MES_NEVER = ['اعطيهم ارقام الصالات فقط', 'رقم الجملة فقط'];

/**
 * The «✦ قواعد:» block in his KB — the same four rules as the persona, carrying
 * the same «إلى»/«إلا» typo plus a second one («يرسل تجديد» for «تحديداً»), plus
 * the showroom-priority line, which is also phone routing. Every arm that moves
 * labels into the structured field strips these, or the KB copy would answer and
 * the measurement would prove nothing.
 */
const MES_KB_RULES = [
    '✦ قواعد:',
    'عند طلب ارقام هواتف ترسل ارقام الصالات فقط',
    'رقم الادارة لا يرسل إلى في حالة طلب رقم الادارة',
    'رقم مبيعات الجملة يرسل تجديد عن طلب مبيعات الجملة',
    'لا تقترح ارقام قسم مبيعات الجملة إلا إذا طلب منك قسم مبيعات الجملة',
    'ارقام الصالات تعطى لاي شخص يسال عن الاسعار',
];

const SCENARIOS: Scenario[] = [
    {
        key: 'mes-contaminated-phones-and-routing-persona',
        merchant: 'MES — instructions inside `phones`, routing rules inside the persona',
        pageKey: 'mes-eval-probe',
        today: {
            // Verbatim from production (page c75b6f33; `phones` editor-confirmed
            // 2026-08-10T10:58Z): two of the three "numbers" are instruction
            // sentences with no digits at all, and the third is the merchant
            // hand-rolling "number + purpose" inside one string.
            profile: {
                phones: [
                    'اعطيهم ارقام الصالات فقط',
                    'رقم الجملة فقط  يطلب مبيعات جملة',
                    '0993301022 الادارة',
                ],
            },
            provenance: CONFIRMED,
            persona: MES_PERSONA_TODAY,
            keepCollections: ['أرقام الأقسام', 'صالات الشركة'],
        },
        standard: {
            // The three department rows become page-level contact points, and
            // the management number stops being a string with a word stuck on it.
            profile: {
                phones: [
                    { number: '0993301002', description: 'خدمة ما بعد البيع' },
                    { number: '0993301010', description: 'مبيعات الجملة' },
                    { number: '0993301055', description: 'قسم المشاريع' },
                    { number: '0993301022', description: 'الإدارة' },
                ],
            },
            provenance: CONFIRMED,
            persona: MES_PERSONA_STANDARD,
            // «صالات الشركة» stays — a showroom owns its own phone alongside its
            // own address. «أرقام الأقسام» is gone; it moved to `phones` above.
            keepCollections: ['صالات الشركة'],
            // The «✦ قواعد:» block — the same four rules as the persona, carrying
            // the same «إلى»/«إلا» typo plus a second one («يرسل تجديد» for
            // «تحديداً»). Plus the showroom-priority line, which is also phone
            // routing. If removing these costs an answer, that is the finding.
            stripFromKb: [
                '✦ قواعد:',
                'عند طلب ارقام هواتف ترسل ارقام الصالات فقط',
                'رقم الادارة لا يرسل إلى في حالة طلب رقم الادارة',
                'رقم مبيعات الجملة يرسل تجديد عن طلب مبيعات الجملة',
                'لا تقترح ارقام قسم مبيعات الجملة إلا إذا طلب منك قسم مبيعات الجملة',
                'ارقام الصالات تعطى لاي شخص يسال عن الاسعار',
            ],
        },
        variants: [
            {
                /**
                 * ⭐ The CONTROL arm — today's data, today's persona, today's KB,
                 * with ONE character changed: «إلى» → «إلا», in both places he
                 * wrote it.
                 *
                 * Why it exists: TODAY → HYBRID moves FOUR things at once (the
                 * data into contact points, the KB rules out, the persona rules
                 * down to policy, and this typo). Reporting the resulting +1 as
                 * evidence for the contact standard would credit the restructure
                 * with a win the typo fix may have earned by itself. This arm
                 * separates them, and the expected finding is that the gain is
                 * the typo — which would make the restructure *safe* rather than
                 * *better*. That is still the answer this work needs; it is just
                 * a different claim, and the honest one.
                 *
                 * ⛔ His SECOND typo («يرسل تجديد» for «تحديداً», on the
                 * wholesale line) is deliberately left in. One variable per arm:
                 * that one governs a different question than «ممكن رقم الادارة».
                 */
                name: 'TYPO-ONLY',
                cfg: {
                    profile: {
                        phones: [
                            'اعطيهم ارقام الصالات فقط',
                            'رقم الجملة فقط  يطلب مبيعات جملة',
                            '0993301022 الادارة',
                        ],
                    },
                    provenance: CONFIRMED,
                    persona: MES_PERSONA_TYPO_FIXED,
                    keepCollections: ['أرقام الأقسام', 'صالات الشركة'],
                    rewriteKb: [MES_TYPO_FIX],
                },
            },
            {
                // Policy stays in the persona; descriptions carry labels only.
                name: 'HYBRID   ',
                cfg: {
                    profile: {
                        phones: [
                            { number: '0993301002', description: 'خدمة ما بعد البيع' },
                            { number: '0993301010', description: 'مبيعات الجملة' },
                            { number: '0993301055', description: 'قسم المشاريع' },
                            { number: '0993301022', description: 'الإدارة' },
                        ],
                    },
                    provenance: CONFIRMED,
                    persona: MES_PERSONA_HYBRID,
                    keepCollections: ['صالات الشركة'],
                    stripFromKb: MES_KB_RULES,
                },
            },
            {
                // ⭐ The cheap candidate: NO new field, NO persona rules — the
                // visibility policy is written INTO the description, which is
                // already free text by design («الإدارة — عند الطلب فقط» is the
                // PR's own worked example). If this scores like HYBRID, the
                // contact standard already carries policy and a `rule` field
                // would be redundant. If it leaks, a structured flag is earned.
                name: 'DESC-RULE',
                cfg: {
                    profile: {
                        phones: [
                            { number: '0993301002', description: 'خدمة ما بعد البيع — عند الطلب فقط' },
                            { number: '0993301010', description: 'مبيعات الجملة — عند طلب الجملة فقط' },
                            { number: '0993301055', description: 'قسم المشاريع — عند الطلب فقط' },
                            { number: '0993301022', description: 'الإدارة — عند الطلب فقط' },
                        ],
                    },
                    provenance: CONFIRMED,
                    persona: MES_PERSONA_STANDARD,
                    keepCollections: ['صالات الشركة'],
                    stripFromKb: MES_KB_RULES,
                },
            },
        ],
        // Real customer questions, harvested from this page's production inbox.
        questions: [
            'رقم تليفون',
            'ارقام للتواصل',
            'أرقام الصالات',
            'السلام عليكم ممكن رقم الادارة',
            'اريد رقم للشكاوي',
            'ارجو رقم شغال للتواصل',
            'ارقام غير صاله ابو رمانه',
            'السعر ورقم مبيعات',
        ],
        expect: [
            // The merchant's policy: a generic phone request goes to showrooms,
            // and the management line is never volunteered.
            { mustNot: [...MES_NEVER, '0993301022'] },
            { mustNot: [...MES_NEVER, '0993301022'] },
            { mustNot: MES_NEVER },
            // Asked for by name — this is the one question that must produce it.
            { must: ['0993301022'], mustNot: MES_NEVER },
            // TWO answers are correct here and the merchant decides which:
            // after-sales (0993301002) handles complaints, but his own rule
            // «رقم الادارة لا يرسل إلا في حالة طلب رقم الادارة او الشكاوي»
            // explicitly licenses the MANAGEMENT line for a complaint. An
            // earlier version asserted after-sales only and scored the
            // policy-following reply as a miss. Assert the leak guard, and that
            // some real contact number is offered rather than a deflection.
            { mustNot: MES_NEVER },
            { mustNot: [...MES_NEVER, '0993301022'] },
            { mustNot: [...MES_NEVER, '0993301022'] },
            { mustNot: MES_NEVER },
        ],
    },
    {
        key: 'shahin-routing-table-in-persona',
        merchant: 'Shahin Resort — 5-number routing table inside an 800/800 persona',
        pageKey: 'shahin-eval-probe',
        today: {
            // Production has only the two numbers in the structured field; every
            // other line, and every routing rule, lives in the persona.
            profile: { phones: ['+963982414141', '0189955'] },
            provenance: CONFIRMED,
            persona: SHAHIN_PERSONA_TODAY,
        },
        standard: {
            // ⭐ The CORRECTED mapping — this is what would actually be migrated.
            // An earlier version labelled `0189955` «الهاتف الأرضي», which reads
            // as a fact about the line's technology and silently DROPS what his
            // own KB says it is for: «لتثبيت الحجز حصرا التواصل هاتفيا عبر
            // 0189955 **أو** 0982414141» — it is the booking FALLBACK, and his
            // booking line is permanently busy, so «الارقام مشغولة عندك رقم
            // تاني» is a question his customers really ask. Both booking lines
            // now carry «الحجوزات» so the editor groups them under one purpose
            // and the fallback is reachable. The rejected mapping is kept as the
            // FLAT-LBL variant below rather than deleted, because "the
            // correction matters" is a claim worth measuring instead of asserting.
            profile: {
                phones: [
                    { number: '0982414141', description: 'الحجوزات والأسعار' },
                    { number: '0995008336', description: 'خدمات المسبح والجاكوزي' },
                    { number: '0931671111', description: 'الشكاوى' },
                    { number: '098996402', description: 'صالة الأعراس' },
                    // 7 digits. origin/main's editor REJECTS this row
                    // (isUsablePhoneEntry inherited extractPhones' 9-digit
                    // floor), which is the lockout this branch fixes; the probe
                    // writes straight to the DB, so the measurement ran either
                    // way, but the merchant could not have saved it.
                    { number: '0189955', description: 'الحجوزات والأسعار — أرضي' },
                ],
                email: 'sales@shahinresort.com',
            },
            provenance: CONFIRMED,
            persona: SHAHIN_PERSONA_STANDARD,
            // His KB repeats the persona's routing table word for word. Strip
            // the number-to-purpose lines so the structured descriptions are the
            // only place left that knows what each line is for. The two POLICY
            // lines (no social-media confirmation, no Sham Cash) are kept — they
            // are not contact data — as is «مكتب عالم شاهين», a separate business.
            stripFromKb: SHAHIN_KB_CONTACT_LINES,
        },
        variants: [
            {
                /**
                 * ⭐ The REJECTED mapping, kept as an arm so the correction is a
                 * measurement rather than an assertion.
                 *
                 * Identical to STANDARD in every respect except one description:
                 * `0189955` is labelled «الهاتف الأرضي» — what the line IS —
                 * instead of «الحجوزات والأسعار — أرضي» — what it is FOR. The
                 * plan flagged the choice as an open owner call ("two separate
                 * purposes reads cleaner, but stops answering 'the line is busy,
                 * another number?'"), and question 4 «الارقام مشغولة عندك رقم
                 * تاني» is exactly the question that call decides. If this arm
                 * loses question 4 and STANDARD keeps it, the call is settled by
                 * data: a description states a number's PURPOSE, never its
                 * hardware.
                 */
                name: 'FLAT-LBL ',
                cfg: {
                    profile: {
                        phones: [
                            { number: '0982414141', description: 'الحجوزات والأسعار' },
                            { number: '0995008336', description: 'خدمات المسبح والجاكوزي' },
                            { number: '0931671111', description: 'الشكاوى' },
                            { number: '098996402', description: 'صالة الأعراس' },
                            { number: '0189955', description: 'الهاتف الأرضي' },
                        ],
                        email: 'sales@shahinresort.com',
                    },
                    provenance: CONFIRMED,
                    persona: SHAHIN_PERSONA_STANDARD,
                    stripFromKb: SHAHIN_KB_CONTACT_LINES,
                },
            },
        ],
        // Real customer questions, harvested from this page's production inbox.
        questions: [
            'كيف فيني اتواصل معكن ؟',
            'في رقم اتصال للحجز',
            'رقم الشكاوي',
            'الارقام مشغولة عندك رقم تاني',
            'في ايميل؟',
            'بدي رقم المدير',
            'شو رقمهم',
        ],
        expect: [
            // Match on the national significant number, NOT the leading zero:
            // both «0982414141» and the E.164 «+963982414141» are correct
            // answers, and asserting the 0-prefixed form scored the second one
            // as a miss — an expectation bug that read as a regression.
            { must: ['982414141'] },
            { must: ['982414141'] },
            { must: ['0931671111'] },
            // The one question the truncated persona line was for: an alternative
            // to the permanently-busy booking line.
            { must: ['0189955'] },
            { must: ['sales@shahinresort.com'] },
            // No manager line exists in either arm. The only correct reply is an
            // honest one — so the assertion is that nothing is invented.
            { mustNot: ['0995008336', '0931671111'] },
            {},
        ],
    },
];

// ── Part 1: the deterministic half ──────────────────────────────────────────

async function loadMainFormatter(): Promise<((p: BusinessProfile | null, prov?: MerchantProvenanceMap) => string | null) | null> {
    try {
        const mod = await import(MAIN_FORMATTER_PATH);
        return mod.formatBusinessInfoPrompt;
    } catch {
        return null;
    }
}

function renderDiff(label: string, a: string | null, b: string | null): boolean {
    const same = a === b;
    console.log(`  ${same ? '✅ IDENTICAL' : '🔴 DIFFERS'}  ${label}`);
    if (!same) {
        console.log('    ── origin/main ──');
        console.log((a ?? '(no block)').split('\n').map((l) => `    | ${l}`).join('\n'));
        console.log('    ── this branch ──');
        console.log((b ?? '(no block)').split('\n').map((l) => `    | ${l}`).join('\n'));
    }
    return same;
}

async function deterministicHalf(): Promise<void> {
    console.log('\n═══ PART 1 — what reaches the model (deterministic, no sampling) ═══\n');
    const mainFormat = await loadMainFormatter();
    if (!mainFormat) {
        console.log('⚠️  origin/main formatter not staged — skipping the byte comparison.');
        console.log('    git show origin/main:packages/shared/src/businessInfoPrompt.ts \\');
        console.log('      > packages/shared/src/__mainBusinessInfoPrompt.ts');
        return;
    }

    let allSame = true;
    for (const s of selected()) {
        console.log(`▸ ${s.merchant}`);
        // The safety question: the merchant's CURRENT data, both formatters.
        const same = renderDiff(
            'current data — main vs branch',
            mainFormat(s.today.profile, s.today.provenance),
            formatBusinessInfoPrompt(s.today.profile, s.today.provenance),
        );
        allSame = allSame && same;

        // The value question: what the standard changes, on this branch only.
        console.log('    ── after migrating to the standard (this branch) ──');
        console.log((formatBusinessInfoPrompt(s.standard.profile, s.standard.provenance) ?? '(no block)')
            .split('\n').map((l) => `    | ${l}`).join('\n'));
        console.log('');
    }

    console.log(allSame
        ? '✅ Every merchant\'s CURRENT prompt is byte-identical on both versions.\n'
          + '   Their replies therefore cannot change — the model sees the same input.'
        : '🔴 A current prompt CHANGED. Stop and explain why before merging.');
}

// ── Part 2: the measured half ───────────────────────────────────────────────

/** The endpoint wraps its payload — `{ success, data: { reply, … } }`. Reading
 *  `json.reply` yields undefined, which the probe would have reported as a
 *  uniform "(no reply)" for every arm, i.e. a green-looking null result. */
interface PlaygroundResponse {
    success: boolean;
    data?: { reply: string | null; replyMethod?: string };
    error?: string;
}

/**
 * The bearer token in use. Starts as `ADMIN_TOKEN` and is replaced in place when
 * it ages out mid-run — see `mintToken`.
 */
let token = ADMIN_TOKEN;

/**
 * Mint a fresh admin token from the LOCAL backend's demo endpoint.
 *
 * ⭐ Exists because a token TTL is not a measurement. A 20-minute, 270-request
 * run outlives the demo JWT, and the honest response to "my credential aged out
 * half way" is to get a new one — not to record whatever the server said instead
 * of a reply. Local-only by construction: `main()` already refuses to run
 * against anything but a localhost database.
 */
async function mintToken(): Promise<string> {
    const res = await fetch(`${BASE_URL}/auth/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    });
    if (!res.ok) throw new Error(`cannot mint a token: POST /auth/demo → HTTP ${res.status}`);
    const json = await res.json() as { data?: { token?: string }; token?: string };
    const fresh = json.data?.token ?? json.token;
    if (!fresh) throw new Error('POST /auth/demo returned no token');
    return fresh;
}

async function post(message: string, persona: string): Promise<Response> {
    return fetch(`${BASE_URL}/admin/ai/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // Field names must match scripts/playground-eval.ts exactly — the
        // endpoint takes `question`, not `message`, and `source: 'eval'`
        // selects the eval pipeline the harness runs under.
        body: JSON.stringify({
            pageId: process.env.PROBE_PAGE_ID,
            channel: 'dm',
            question: message,
            source: 'eval',
            brandVoiceNotes: persona,
        }),
    });
}

/**
 * Ask one question and return the reply.
 *
 * ⛔⭐ A non-2xx never becomes a score. It used to be returned as the reply
 * string, and that is the single worst defect this probe has had: on 2026-08-13
 * the admin JWT expired 18 minutes into a 5-run measurement, every subsequent
 * request came back `[HTTP 401] Invalid or expired token`, and the grader scored
 * that text as a customer reply — turning Shahin's 7/7 into 2/7 and a 71% "flip
 * rate". Read without the transcript, that is a catastrophic regression in a
 * merchant's replies. It was an expired credential.
 *
 * So an HTTP failure is not a datum about the merchant's configuration:
 *   - 401 → mint a fresh token and retry (TTL is the near-universal cause).
 *   - 429/5xx → backoff and retry, same table as the eval harness.
 *   - anything else, or retries exhausted → THROW. A measurement that cannot
 *     complete must fail loudly rather than report numbers assembled partly
 *     from error strings.
 */
/**
 * Transient statuses and backoff, matching `scripts/playground-eval.ts` exactly.
 *
 * Same problem, same numbers, deliberately: an OpenAI 429 burst surfaces here as
 * a backend 500, and the eval harness already learned (2026-07-05, 101 false
 * FAILs) that throttling must be retried rather than scored. Diverging would
 * mean two instruments disagreeing about what counts as a failed reply.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [2000, 8000, 20000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ask(message: string, persona: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
        let res = await post(message, persona);

        if (res.status === 401) {
            console.log('  ⚠️  token expired mid-run — minting a fresh one and retrying');
            token = await mintToken();
            res = await post(message, persona);
        }

        if (res.ok) {
            const json = await res.json() as PlaygroundResponse;
            return json.data?.reply ?? '(no reply)';
        }

        const body = (await res.text()).slice(0, 200);
        if (RETRYABLE_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
            const retryAfterSec = parseFloat(res.headers.get('retry-after') || '');
            await sleep(Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : RETRY_DELAYS_MS[attempt]);
            continue;
        }
        throw new Error(
            `playground request failed — HTTP ${res.status}: ${body}\n`
            + '   The run is ABORTED on purpose: an error response is not a reply and must not be scored.',
        );
    }
}

interface Verdict {
    pass: boolean;
    /** Human-readable reason, empty on a pass. */
    detail: string;
}

/**
 * Score one reply against one question's expectations.
 *
 * Split from its rendering so the pass/fail bit can be counted (per-run scores,
 * flip rate) without re-deriving it from a display string — two readings of the
 * same fact drift.
 */
function evaluate(reply: string, e: { must?: string[]; mustNot?: string[] }): Verdict {
    const missing = (e.must ?? []).filter((s) => !reply.includes(s));
    const leaked = (e.mustNot ?? []).filter((s) => reply.includes(s));
    if (missing.length === 0 && leaked.length === 0) return { pass: true, detail: '' };
    const parts: string[] = [];
    if (missing.length) parts.push(`missing ${missing.join(', ')}`);
    if (leaked.length) parts.push(`LEAKED ${leaked.join(', ')}`);
    return { pass: false, detail: parts.join(' · ') };
}

/**
 * Apply this arm's KB edits: drop the `stripFromKb` lines, then apply the
 * `rewriteKb` substitutions.
 *
 * Line-level substring match for the strip, deliberately: the merchant's own
 * line («للشكاوي : 0931671111») is the unit of meaning, and matching a fragment
 * lets the fixture survive the whitespace and punctuation drift real merchant
 * prose is full of (double spaces, «الجتماعي» for «الاجتماعي»).
 *
 * ⭐ THROWS on a pattern that matches nothing, and that is the point. A strip
 * pattern that silently no-ops leaves the routing table in the KB, so the
 * structured descriptions are not the only remaining source and the arm proves
 * nothing — the exact defect recorded in `stripFromKb`'s own comment, which the
 * probe previously could only warn about by printing a line count nobody
 * checked. Same for a rewrite: an unmatched typo fix makes TYPO-ONLY a silent
 * duplicate of TODAY and would be reported as "the typo costs nothing".
 * A fixture the merchant has since edited must fail loudly, not measure quietly.
 */
function transformKb(kb: string, arm: Arm): string {
    let out = kb;

    if (arm.stripFromKb?.length) {
        for (const pattern of arm.stripFromKb) {
            if (!out.split('\n').some((line) => line.includes(pattern))) {
                throw new Error(`stripFromKb pattern matches no KB line — fixture drifted: «${pattern}»`);
            }
        }
        out = out.split('\n').filter((line) => !arm.stripFromKb!.some((s) => line.includes(s))).join('\n');
    }

    for (const { from, to } of arm.rewriteKb ?? []) {
        const occurrences = out.split(from).length - 1;
        if (occurrences !== 1) {
            throw new Error(
                `rewriteKb anchor must match exactly once, found ${occurrences} — fixture drifted: «${from}»`,
            );
        }
        out = out.replace(from, to);
    }

    return out;
}

/**
 * Drop the collections this arm does not keep, and report what was hidden.
 *
 * Rows cascade with their collection, so the caller restores from a snapshot
 * taken before the first arm ran — never by re-inserting from these returns.
 */
async function applyCollections(sql: postgres.Sql, pageId: string, keep?: string[]): Promise<string[]> {
    const all = await sql<{ id: string; label: string }[]>`
        SELECT id, label FROM fact_collections WHERE page_id = ${pageId}
    `;
    if (!keep) return [];
    const drop = all.filter((c) => !keep.includes(c.label));
    for (const c of drop) {
        await sql`DELETE FROM fact_collections WHERE id = ${c.id}`;
    }
    return drop.map((c) => c.label);
}

/**
 * Belt-and-braces cache clear between runs.
 *
 * ⭐ Corrected 2026-08-13 — this comment used to claim the clear was what kept
 * one arm from scoring another's answers, and that is NOT the mechanism. Two
 * independent bypasses already guarantee it, and knowing which is load-bearing
 * matters because the FLIP RATE below is only meaningful if repeat runs are
 * independent samples rather than replayed cache hits:
 *   1. `pipeline === 'eval'` bypasses ALL caches in BOTH directions — no reads,
 *      no writes (`backend/src/services/ai.ts:470`, and the probe sends
 *      `source: 'eval'`, which `playgroundContext.ts:238` maps to that
 *      pipeline). This is the one that makes N runs N samples.
 *   2. DMs never reach the semantic cache at all (`ai.ts:555/564`,
 *      `channel !== 'dm'`), so only the exact-text layer was ever in play here.
 * Kept anyway: it costs one request per run and it is the guard that would save
 * the measurement if a future edit changed `source` to 'playground'.
 */
async function clearReplyCache(): Promise<void> {
    await fetch(`${BASE_URL}/ai/cache`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    }).catch(() => { /* a cold cache is the desired state anyway */ });
}

/**
 * Report one scenario: per-run scores, the FLIP RATE, and per-question verdicts.
 *
 * ⭐ Why the flip rate is the headline and a single score is not: at temperature
 * 0 the model is still not deterministic, and every reply number this probe has
 * produced so far was a single run. The arm ORDERING has held across repeats
 * while the COUNTS have not, so "MES 7/8 → 8/8" is a claim about one sample of a
 * distribution. A cell that flips is a cell whose arm difference cannot be read
 * off one run at all; reporting the two together is what stops a ±1 sampling
 * artefact from being presented as a win.
 *
 * The full replies go to the transcript file (`PROBE_TRANSCRIPT`); stdout keeps
 * only what needs reading — every failing and every unstable cell, with a
 * representative reply, because a verdict without the reply is how a GRADER gap
 * gets mistaken for a regression.
 */
function reportScenario(s: Scenario, arms: NamedArm[], replies: Record<string, string[][]>): void {
    const verdicts: Record<string, Verdict[][]> = {};
    for (const arm of arms) {
        verdicts[arm.name] = replies[arm.name].map(
            (run) => run.map((reply, i) => evaluate(reply, s.expect[i])),
        );
    }

    const total = s.questions.length;
    console.log(`  ARM SCORES — ${RUNS} run${RUNS === 1 ? '' : 's'} of ${total} questions`);
    for (const arm of arms) {
        const perRun = verdicts[arm.name].map((run) => run.filter((v) => v.pass).length);
        const mean = perRun.reduce((a, b) => a + b, 0) / perRun.length;
        const flipped = s.questions.filter((_, i) => {
            const passes = verdicts[arm.name].map((run) => run[i].pass);
            return passes.some((p) => p !== passes[0]);
        }).length;
        console.log(
            `    ${arm.name}  ${perRun.map((n) => `${n}/${total}`).join('  ')}`
            + `   → mean ${mean.toFixed(1)}/${total}`
            + `   range ${Math.min(...perRun)}–${Math.max(...perRun)}`
            + `   FLIP ${flipped}/${total}`
            + (flipped ? ` (${((flipped / total) * 100).toFixed(0)}%)` : ' (stable)'),
        );
    }

    console.log('\n  PER QUESTION');
    s.questions.forEach((q, i) => {
        console.log(`  «${q}»`);
        for (const arm of arms) {
            const cell = verdicts[arm.name].map((run) => run[i]);
            const strip = cell.map((v) => (v.pass ? '✅' : '🔴')).join('');
            const stable = cell.every((v) => v.pass === cell[0].pass);
            const passes = cell.filter((v) => v.pass).length;
            console.log(
                `    ${arm.name} ${strip}  ${stable ? (cell[0].pass ? 'stable pass' : 'stable FAIL') : `FLIP ${passes}✅/${RUNS - passes}🔴`}`,
            );
            // Print a reply only where it is needed to judge: any failure, and
            // both sides of an unstable cell. Stable passes are in the transcript.
            if (!stable || !cell[0].pass) {
                const shown = new Set<string>();
                cell.forEach((v, run) => {
                    const key = v.pass ? 'pass' : v.detail;
                    if (shown.has(key)) return;
                    shown.add(key);
                    const reply = replies[arm.name][run][i].replace(/\n/g, ' ⏎ ');
                    console.log(
                        `        run${run + 1} ${v.pass ? '✅' : `🔴 ${v.detail}`} · `
                        + (reply.length > 220 ? `${reply.slice(0, 220)}…` : reply),
                    );
                });
            }
        }
        console.log('');
    });

    if (TRANSCRIPT) {
        const lines: string[] = [`### ${s.merchant}`, `page: ${s.pageKey}  runs: ${RUNS}`, ''];
        s.questions.forEach((q, i) => {
            lines.push(`«${q}»`);
            for (const arm of arms) {
                for (let run = 0; run < RUNS; run++) {
                    const v = verdicts[arm.name][run][i];
                    lines.push(`  ${arm.name} run${run + 1} ${v.pass ? 'PASS' : `FAIL ${v.detail}`}`);
                    lines.push(`    ${replies[arm.name][run][i].replace(/\n/g, ' ⏎ ')}`);
                }
            }
            lines.push('');
        });
        appendFileSync(TRANSCRIPT, `${lines.join('\n')}\n`);
    }
}

async function measuredHalf(sql: postgres.Sql): Promise<void> {
    console.log(`\n═══ PART 2 — the replies a customer would get (measured, ${RUNS} run${RUNS === 1 ? '' : 's'} per arm) ═══\n`);

    for (const s of selected()) {
        const [page] = await sql`
            SELECT id, business_profile, knowledge_base
            FROM pages WHERE facebook_page_id = ${s.pageKey} LIMIT 1
        `;
        if (!page) {
            console.log(`⚠️  probe page ${s.pageKey} not found — skipping ${s.key}.\n`);
            continue;
        }
        process.env.PROBE_PAGE_ID = page.id;
        const originalProfile = page.business_profile;
        const originalKb = page.knowledge_base;
        // Snapshot BEFORE any arm mutates: collections and their rows, so the
        // restore is a replay of what was found and not a reconstruction.
        // SELECT * — never a column list. Snapshotting a subset once dropped
        // `page_id` and the restore inserted NULLs, which the NOT NULL
        // constraint caught only AFTER the DELETE had already run: the fixture
        // was destroyed by its own backup. A restore must replay whole rows.
        const savedCollections = await sql`
            SELECT * FROM fact_collections WHERE page_id = ${page.id}
        `;
        const savedRows = await sql`
            SELECT fr.* FROM fact_rows fr
            JOIN fact_collections fc ON fc.id = fr.collection_id
            WHERE fc.page_id = ${page.id}
        `;

        try {
            console.log(`▸ ${s.merchant}`);
            console.log(`  page: ${s.pageKey}  ·  persona: ${s.today.persona.length} → ${s.standard.persona.length} chars\n`);
            const arms = [
                { name: 'TODAY    ', cfg: s.today },
                { name: 'STANDARD ', cfg: s.standard },
                ...(s.variants ?? []),
            ];
            /** replies[armName][runIndex][questionIndex] */
            const replies: Record<string, string[][]> = {};

            for (const arm of arms) {
                // Bump both version counters — the profile is prompt-injected,
                // so a stale page cache would answer from the previous arm.
                // The KB is left alone unless the scenario overrides it: the
                // probe page already carries the merchant's own prose.
                const armKb = transformKb(s.knowledgeBase ?? (originalKb as string), arm.cfg);
                if (arm.cfg.stripFromKb?.length) {
                    const removed = (originalKb as string).split('\n').length - armKb.split('\n').length;
                    console.log(`  ${arm.name} KB lines stripped: ${removed}`);
                }
                if (arm.cfg.rewriteKb?.length) {
                    console.log(`  ${arm.name} KB lines rewritten: ${arm.cfg.rewriteKb.length}`);
                }
                await sql`
                    UPDATE pages
                    SET business_profile = ${sql.json({
                        merchant: arm.cfg.profile,
                        merchantProvenance: arm.cfg.provenance ?? {},
                    } as never)},
                        knowledge_base = ${armKb},
                        kb_version = kb_version + 1,
                        kb_active_version = kb_active_version + 1
                    WHERE id = ${page.id}
                `;
                // Restore every collection first, then re-apply this arm's cut,
                // so arm order cannot leak (STANDARD dropping one would
                // otherwise leave it dropped for a later arm).
                await restoreCollections(sql, page.id, savedCollections, savedRows);
                const dropped = await applyCollections(sql, page.id, arm.cfg.keepCollections);
                if (dropped.length) console.log(`  ${arm.name} lists removed: ${dropped.join(', ')}`);

                // N independent runs against this arm's single DB state. The
                // state is written once, above, because re-writing it per run
                // would bump `kb_active_version` and re-measure retrieval as
                // well as the model — the variance under test is the model's.
                replies[arm.name] = [];
                for (let run = 0; run < RUNS; run++) {
                    await clearReplyCache();
                    const runReplies: string[] = [];
                    for (const q of s.questions) {
                        runReplies.push(await ask(q, arm.cfg.persona));
                    }
                    replies[arm.name].push(runReplies);
                    process.stdout.write(`  ${arm.name} run ${run + 1}/${RUNS} done\n`);
                }
            }
            console.log('');

            reportScenario(s, arms, replies);
        } finally {
            // Always put the probe page back the way it was found — profile, KB
            // AND lists, or the next run scores a half-migrated fixture.
            await sql`
                UPDATE pages
                SET business_profile = ${sql.json(originalProfile as never)},
                    knowledge_base = ${originalKb},
                    kb_version = kb_version + 1,
                    kb_active_version = kb_active_version + 1
                WHERE id = ${page.id}
            `;
            await restoreCollections(sql, page.id, savedCollections, savedRows);
        }
    }
}

/**
 * Put the page's lists back exactly as snapshotted (idempotent).
 *
 * ONE transaction: the delete and the re-insert must stand or fall together.
 * Without that, a restore that throws half-way leaves the page with no lists at
 * all — which is how this probe deleted its own MES fixture on first run.
 */
async function restoreCollections(
    sql: postgres.Sql,
    pageId: string,
    collections: postgres.Row[],
    rows: postgres.Row[],
): Promise<void> {
    await sql.begin(async (tx) => {
        await tx`DELETE FROM fact_collections WHERE page_id = ${pageId}`;
        for (const c of collections) {
            await tx`INSERT INTO fact_collections ${tx(c as never)}`;
        }
        for (const r of rows) {
            await tx`INSERT INTO fact_rows ${tx(r as never)}`;
        }
    });
}


async function main(): Promise<void> {
    assertScenariosWellFormed();
    console.log('Contact-standard probe');
    console.log(`  backend : ${BASE_URL}`);
    console.log(`  database: ${DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@')}`);
    console.log(`  runs    : ${RUNS} per arm`);
    const skipped = SCENARIOS.filter((s) => !selected().includes(s));
    if (skipped.length) {
        // Named, never silent: a partial run that reads as a full one is how a
        // stale number survives into a report.
        console.log(`  ⚠️  PARTIAL RUN — scenarios NOT measured: ${skipped.map((s) => s.key).join(', ')}`);
    }
    if (TRANSCRIPT) {
        // Truncate up front — appending to a previous run's file would present
        // two different measurements as one.
        writeFileSync(TRANSCRIPT, `# Contact-standard probe transcript · ${RUNS} runs per arm\n\n`);
        console.log(`  transcript: ${TRANSCRIPT}`);
    }

    if (/\bjawab24\b|prod/i.test(DATABASE_URL) && !DATABASE_URL.includes('localhost')) {
        throw new Error('Refusing to run: this probe WRITES to the carrier page and must never point at production.');
    }

    await deterministicHalf();

    if (!ADMIN_TOKEN) {
        console.log('\n⚠️  ADMIN_TOKEN not set — skipping the measured half.');
        return;
    }
    const sql = postgres(DATABASE_URL, { max: 2 });
    try {
        await measuredHalf(sql);
    } finally {
        await sql.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

/*
 * ── Optional: the literal two-server arm ────────────────────────────────────
 *
 * Part 1 already settles the safety question exactly, but if you want the two
 * versions running side by side (to exercise the HTTP layer, the editor, or
 * anything outside the formatter), this is the shape:
 *
 *   git worktree add ../baseline origin/main --detach
 *   cp backend/.env ai-worker/.env  ../baseline/…      # gitignored, not carried
 *   cd ../baseline && npm install && (cd packages/shared && npm run build)
 *   PORT=3230 AI_SERVICE_URL=http://localhost:3231 DATABASE_URL=<same local DB> npm run dev -w backend
 *   PORT=3231 npm run dev -w ai-worker
 *
 * Point BOTH arms at the SAME database, so the only variable is the code.
 * ⚠️ origin/main cannot READ a described phone entry — `businessPhoneList`
 * there assumes strings — so only the "current data" row of the matrix is
 * meaningful on that arm. That asymmetry is why the matrix has three cells,
 * not four:
 *
 *            │ code = origin/main        │ code = this branch
 *   ─────────┼───────────────────────────┼──────────────────────────
 *   data as  │ A — the status quo        │ B — must equal A
 *   it is    │                           │
 *   ─────────┼───────────────────────────┼──────────────────────────
 *   migrated │ (not applicable)          │ C — the improvement
 */
