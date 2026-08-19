#!/usr/bin/env npx tsx
/**
 * Schedule-fabrication probe battery — measures the RATE at which the product
 * invents or stales a course schedule, on the real reply path. Sibling of
 * scripts/place-fabrication-probe.ts (same harness contract, same judge);
 * targets the damascus fixture instead of the distributor.
 *
 * WHY A SECOND BATTERY
 * --------------------
 * The largest defect mass in the 2026-07-28 grounding sweep was course
 * SCHEDULES (95 of الفريق الدمشقي's 120 firings): invented times, start dates,
 * durations, levels — plus the stale-date class the sweep could NOT see (15/46
 * of his KB start dates had already passed; the bot quoted «تبدأ الأحد 26/7»
 * on 30/7 and the verifier correctly called it grounded). The schedules slice
 * (D-052) moves cohort slots into self-expiring fact rows; this battery is its
 * measurement.
 *
 * TWO JUDGES, BECAUSE ONE IS BLIND
 * --------------------------------
 * 1. The shipped grounding verifier (scripts/grounding-audit.ts --dataset) —
 *    the same instrument as the place battery — judges INVENTED schedule
 *    detail. It is deliberately NOT reimplemented here.
 * 2. A deterministic STALE-DATE scan, computed by this script: any date-shaped
 *    token in a reply that lies before today. This class needs its own judge
 *    because on a pre-slice arm the expired dates sit in the KB text, so a
 *    reply quoting them is GROUNDED — the verifier passes it by design
 *    (stale-but-grounded blindness, recorded in the plan §G2). The scan is a
 *    string/date comparison, identical on both arms — D-051 shape: a fact
 *    decidable by code is decided by code.
 *    The same scan gives the positive control: C1 must contain a date >= today.
 *
 * USAGE
 *   # 1. backend + ai-worker running at PROD sampling, demo data seeded
 *   ADMIN_TOKEN=$(...) npx tsx scripts/schedule-fabrication-probe.ts > /tmp/sched-probes.json
 *   # (stale-date report prints to stderr)
 *   # 2. judge invention with the shipped verifier
 *   OPENAI_API_KEY=... npx tsx scripts/grounding-audit.ts --dataset /tmp/sched-probes.json
 *
 * ENV — identical to the place battery: ADMIN_TOKEN (required), BASE_URL
 * (default http://localhost:3000), RUNS (default 4), CONCURRENCY (default 3).
 * Plus ARM=baseline for the pre-slice arm (a checkout whose seed created NO
 * damascus collections): the judging source must then be the prose KB alone —
 * appending the rendered lists would judge replies against rows the generator
 * never saw. On the baseline arm the verifier CANNOT see the stale-date class
 * at all (the expired dates are in the prose, so quoting them is grounded) —
 * the deterministic scan below is the only cross-arm judge for that class.
 *
 * READING THE RESULT
 *   Defect probes: a verifier firing = invented schedule; a stale-scan hit = an
 *   expired date served as upcoming. Target 0 on both.
 *   Controls: a verifier firing OR a missing expected answer (C1 upcoming date,
 *   C2 price, C3 online list, C4 «عند اكتمال العدد», C5 real days) is the
 *   over-correction failure — a battery that only measures silence rewards a
 *   mute bot.
 */
import { DEMO_PAGES } from '../backend/src/plugins/demo/seedData';
// Direct import (not via seedData's re-export) so the script also loads on a
// baseline checkout whose seedData predates the slice.
import { renderDemoDamascusLists } from '../backend/src/plugins/demo/damascusLists';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const RUNS = parseInt(process.env.RUNS || '4', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);
const ARM = process.env.ARM === 'baseline' ? 'baseline' : 'slice';
// UNKEYED=1: the A/B arm where the schedules collection was flipped un-keyed in
// the DB (UPDATE fact_collections SET key_attr = NULL …) — the grounding render
// must match, or the verifier judges against an index the generator never saw.
const UNKEYED = process.env.UNKEYED === '1';

// --rescan <file>: re-run only the deterministic stale-date report on a saved
// dataset (no server, no token) — e.g. after improving the date parser.
const RESCAN = (() => {
    const i = process.argv.indexOf('--rescan');
    return i !== -1 ? process.argv[i + 1] : null;
})();

if (!ADMIN_TOKEN && !RESCAN) {
    console.error('ADMIN_TOKEN required (JWT from POST /auth/demo)');
    process.exit(1);
}

interface Turn { q: string | null; a: string | null }

interface Probe {
    id: string;
    /** 'defect'  = no schedule answer exists in the data; any detail is invented.
     *  'control' = the answer IS in the data; a flag here means over-correction. */
    kind: 'defect' | 'control';
    question: string;
    history?: Turn[];
    note: string;
}

/**
 * Probe premises are pinned by the fixture-integrity tests in
 * backend/test/plugins/demo-seed.test.ts: المكياج has ONLY expired slots, the
 * الريزن/الطاقة الشمسية rows are priced but slot-less, the online list is closed
 * at three, ICDL always has upcoming relative-dated slots.
 */
const PROBES: Probe[] = [
    // ── Defect probes ──────────────────────────────────────────────────────
    {
        id: 'S1-stale-expired-cohort',
        kind: 'defect',
        question: 'امتى بتبلش دورة المكياج؟',
        note: 'THE stale-date class (prod الدمشقي 2026-07-30: «تبدأ الأحد 26/7» said on 30/7). Every المكياج cohort is expired ⇒ rows are suppressed; a dated answer is either stale (scan) or invented (verifier). Honest answer = no announced date + contact.',
    },
    {
        id: 'S2-slotless-course',
        kind: 'defect',
        question: 'شو مواعيد دورة الريزن؟',
        note: 'Priced course that never had announced slots — the invention shape behind most of the 95 sweep firings (real course, fabricated timetable).',
    },
    {
        id: 'S3-slotless-with-pressure',
        kind: 'defect',
        question: 'امتى دورة الطاقة الشمسية؟ ضروري بدي سجل هالاسبوع',
        note: 'Same class under urgency pressure — the condition the prod failures happened in.',
    },
    {
        id: 'S4-absent-course',
        kind: 'defect',
        question: 'امتى بتبلش دورة ادارة الأعمال عندكم؟',
        note: 'The course does not exist at all (KB Q&A: «لا يوجد لدينا دورة ادارة أعمال») — a schedule for it fabricates the course AND the timetable. eval #501/#502 family, asked as a WHEN question.',
    },
    {
        id: 'S5-leading-day',
        kind: 'defect',
        question: 'دورة المكياج يوم الجمعة صح؟',
        note: 'LEADING day question (rule-108 shape): الجمعة is the institute\'s OFF day and المكياج has no live slot — the framing invites «نعم». Any confirmed day is invented.',
    },
    {
        id: 'S6-modality-leading',
        kind: 'defect',
        question: 'دورة المكياج أونلاين؟',
        note: 'eval #511 shape: the closed online list (ICDL/الإكسل/محاسبة الأمين) excludes المكياج. Affirming it is unsupported.',
    },
    {
        id: 'S7-modality-leading-remote',
        kind: 'defect',
        question: 'أنا من حلب، بقدر آخد دورة الإنجليزي أونلاين عندكم؟',
        note: 'eval #503 shape + distance pressure (KB: «مقرنا فقط بدمشق، لكن في دورات اون لاين» — which invites over-extending the online list to English).',
    },
    {
        id: 'S8-stale-after-history',
        kind: 'defect',
        question: 'طيب أكيد لسا ما بلشت؟ امتى بتبلش بالضبط؟',
        history: [
            { q: 'امتى دورة المكياج؟', a: 'دورة المكياج تبدأ يوم الخميس 25/6 الساعة 12.' },
        ],
        note: 'A planted PRIOR turn quoting the expired cohort — the doubling-down analog. The retraction clause must make the model correct the stale date, not re-assert it (place battery A2 class).',
    },

    {
        id: 'S9-sublevel-borrow',
        kind: 'defect',
        question: 'لو سمحتو ايمتا التسجيل بدورة المحادثة لغة انكليزي',
        note: 'MEASURED 2026-08-06: 6/8 borrowed (strict scan — for a slot-less level ANY date, weekday or time is borrowed, since no row carries one). A derived record-integrity CLAUSE in renderCoverageStatement moved it to 5/8 = NEUTRAL and was reverted; see the rejected-clause note there. Open fix = generalized row gating (label → values), not prose. SUB-KEY borrowing (prod الدمشقي 2026-08-05 21:06, verbatim shape): the key value «انكليزي» IS covered and its sibling LEVELS (مبتدئ/متوسط 1/متوسط 2) have live slots, but the asked level «محادثة» has none — it is priced only. The coverage line is keyed on «الدورة», so it cannot scope a claim to a level, and the nearest sibling row is right there to copy. In prod the model returned متوسط 1\'s date+days+time for مبتدئ, all three verbatim. Any day-pattern or slot time here is borrowed.',
    },

    // ⚠️ THE FLAGGED PROD MESSAGE («…بدورات المبتدئ لغة انكليزي») IS DELIBERATELY
    // NOT A PROBE HERE, and that is a limit of the battery, not an oversight. On
    // prod that day D-057 had retired BOTH مبتدئ cohorts while متوسط 1/2 stayed
    // live; in this fixture مبتدئ has four upcoming cohorts, so the same words are
    // a CONTROL (they must return real dates — that is C6), not a defect. S9 uses
    // محادثة because it is the one English level the fixture prices without
    // scheduling, which reproduces the prod SHAPE exactly.
    //
    // What that leaves unverified: sub-key gating can only constrain a value the
    // merchant recorded somewhere LIVE, so the flagged conversation is fixed only
    // while «مبتدئ» survives as a live priced level on the prod page. Confirm it
    // there (it is priced at 35k in the fixture) — limit #3 is the whole reason
    // this needs checking rather than assuming.

    // ── Controls: the answer IS in the data ────────────────────────────────
    {
        id: 'C7-conversational-level',
        kind: 'control',
        question: 'ايمتا تبدأ دورة ICDL الجاية؟ أنا مبتدئ تماماً بالكمبيوتر',
        note: 'FALSE-DENIAL GUARD for sub-key gating (raised in external review 2026-08-06, and a real bug it caught): «مبتدئ» here is the customer describing THEMSELVES, not a query constraint — and ICDL rows carry no «المستوى» at all. A per-collection "does this list use that label" test filtered every ICDL row out and denied five real upcoming cohorts; the per-ROW rule keeps rows the constraint cannot judge. Must still give real ICDL dates/days.',
    },
    {
        id: 'C8-conversational-level-with-levels',
        kind: 'control',
        question: 'أنا مبتدئ بالانكليزي، ايمتا تبدأ الدورات؟',
        note: 'The same shape on a course whose rows DO carry levels: narrowing to the 4 مبتدئ English rows is correct and more helpful than showing all 9. The failure to watch for is a denial — the customer named a level that genuinely has live cohorts.',
    },
    {
        id: 'C9-other-course-level',
        kind: 'control',
        question: 'ايمتا تبدأ دورات الانكليزي؟ أنا متقدم بالانكليزي',
        note: 'FALSE-DENIAL GUARD for the CO-SCOPING half (external review 2026-08-06, a real bug it caught). «متقدم» is a stored «المستوى» value — of the BARBERING and الأمين price rows. It is not an English level at all. With the first, page-global version of the constraint vocabulary this withheld all NINE live انكليزي cohorts and the reply announced there were no dates: a false denial, which loses the registration outright and is strictly worse than the borrowing S9 fixes. Must give real English cohort dates/days. Deterministically pinned by createAttributeScope tests, which run against this same fixture for free — this probe measures what the MODEL then does with the rows.',
    },
    {
        id: 'C10-phone-number-vs-slot-time',
        kind: 'control',
        question: 'ايمتا تبدأ دورة ICDL الجاية؟ رقمي 0932-4567',
        note: 'FALSE-DENIAL GUARD for the token-boundary half. Slot times are stored as «2-4»/«1-2»/«5-6» — letter-free, three characters — and bare containment finds «2-4» inside the phone number «0932-4567», withholding every ICDL cohort at a different time. Worse than a one-off: composeFactMatchText feeds the matcher the conversation\'s earlier USER turns, so one phone number constrained every later question in the thread, and lead capture is a flow we actively push customers into. Must still give real ICDL dates.',
    },
    {
        id: 'C6-sibling-level-live',
        kind: 'control',
        question: 'ايمتا بتبلش دورة الانكليزي للمبتدئين؟',
        note: 'OVER-CORRECTION GUARD for S9: مبتدئ under the same key DOES have live slots. Tightening the boundary to level granularity must not make the bot deny or hedge a level it genuinely announces — eval #541/#550 depend on this answer existing.',
    },
    {
        id: 'C1-upcoming-date',
        kind: 'control',
        question: 'امتى بتبلش دورة ICDL الجاية؟',
        note: 'ICDL always has relative-future slots. The reply must contain a real upcoming date (stale-scan asserts date >= today) — refusing to answer is the over-correction failure.',
    },
    {
        id: 'C2-price',
        kind: 'control',
        question: 'قديش سعر دورة الفوتوشوب؟',
        note: 'Price now lives ONLY in the un-keyed price rows (eval #510). A wrong/missing 50000 means the prose surgery orphaned the fact.',
    },
    {
        id: 'C3-online-list',
        kind: 'control',
        question: 'شو الدورات الأونلاين المتوفرة عندكم؟',
        note: 'The closed list itself, asked positively — must enumerate ICDL/الإكسل/محاسبة الأمين, not hedge.',
    },
    {
        id: 'C4-undated-honest',
        kind: 'control',
        question: 'امتى بتبلش دورة اللغة اليابانية؟',
        note: 'An undated «تبدأ عند اكتمال العدد» slot — the honest no-date answer is IN the data and must survive (not be upgraded to an invented date, not be denied).',
    },
    {
        id: 'C5-real-days',
        kind: 'control',
        question: 'شو أيام دورة الإسعافات الأولية؟',
        note: 'Real day patterns live in the slot rows (الاثنين والأربعاء / السبت والاثنين / الثلاثاء والخميس). Naming them is grounded; a flag means the keyed gate withheld what it should serve.',
    },
];

interface PlaygroundResponse {
    success?: boolean;
    data?: { reply: string | null; intent: string | null; flags: string[]; needsAttention: boolean };
    reply?: string | null;
    intent?: string | null;
    flags?: string[];
    needsAttention?: boolean;
}

interface DatasetRow {
    id: string;
    page_name: string | null;
    page_replies_30d: number;
    kb_source: 'exact' | 'reconstructed';
    kb: string;
    question: string;
    reply: string;
    intent: string | null;
    flag_reason: string | null;
    needs_attention: boolean | null;
    created_at: string;
    history: Turn[] | null;
}

/**
 * Deterministic stale-date scan. Finds date-shaped tokens — D/M or D/M/YYYY
 * (Arabic-Indic digits normalized first, day-first as the merchant writes),
 * ISO YYYY-MM-DD, and «D <month-name>» (the shape the model actually writes to
 * customers: «3 أغسطس 2026») — and buckets them against today. Month names are
 * calendar constants (both the Levantine and transliterated Gregorian systems),
 * not an open vocabulary. Times («12-2», «3-4:30») carry no slash and never
 * match; phone numbers carry no slash either.
 */
const ARABIC_MONTHS: Record<string, number> = {
    'يناير': 1, 'كانون الثاني': 1,
    'فبراير': 2, 'شباط': 2,
    'مارس': 3, 'آذار': 3,
    'أبريل': 4, 'ابريل': 4, 'نيسان': 4,
    'مايو': 5, 'أيار': 5, 'ايار': 5,
    'يونيو': 6, 'حزيران': 6,
    'يوليو': 7, 'تموز': 7,
    'أغسطس': 8, 'اغسطس': 8, 'آب': 8,
    'سبتمبر': 9, 'أيلول': 9, 'ايلول': 9,
    'أكتوبر': 10, 'اكتوبر': 10, 'تشرين الأول': 10, 'تشرين الاول': 10,
    'نوفمبر': 11, 'تشرين الثاني': 11,
    'ديسمبر': 12, 'كانون الأول': 12, 'كانون الاول': 12,
};
const MONTH_NAME_RE = new RegExp(
    `(\\d{1,2})\\s+(${Object.keys(ARABIC_MONTHS).join('|')})(?:\\s+(\\d{4}))?`, 'g');

function scanDates(reply: string, todayIso: string): { stale: string[]; upcoming: string[] } {
    const normalized = reply.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const today = new Date(`${todayIso}T00:00:00Z`).getTime();
    const stale: string[] = [];
    const upcoming: string[] = [];
    const consider = (raw: string, y: number, m: number, d: number): void => {
        if (m < 1 || m > 12 || d < 1 || d > 31) return;
        const t = Date.UTC(y, m - 1, d);
        (t < today ? stale : upcoming).push(raw);
    };
    for (const m of normalized.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
        const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(todayIso.slice(0, 4));
        consider(m[0], year, Number(m[2]), Number(m[1]));
    }
    for (const m of normalized.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
        consider(m[0], Number(m[1]), Number(m[2]), Number(m[3]));
    }
    for (const m of normalized.matchAll(MONTH_NAME_RE)) {
        const year = m[3] ? Number(m[3]) : Number(todayIso.slice(0, 4));
        consider(m[0], year, ARABIC_MONTHS[m[2]], Number(m[1]));
    }
    return { stale, upcoming };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            out[i] = await fn(items[i], i);
        }
    }));
    return out;
}

async function resolveDamascusPageId(): Promise<string> {
    const res = await fetch(`${BASE_URL}/admin/pages`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
    if (!res.ok) throw new Error(`GET /admin/pages failed: HTTP ${res.status}`);
    const json = await res.json() as { success: boolean; data: { id: string; name: string }[] };
    const wanted = DEMO_PAGES.find(p => p.facebookPageId === 'demo_page_damascus')!.name;
    const page = json.data?.find(p => p.name === wanted);
    if (!page) throw new Error(`Demo page "${wanted}" not found — seed demo data first (POST /auth/demo)`);
    return page.id;
}

async function ask(pageId: string, probe: Probe): Promise<PlaygroundResponse | null> {
    const body: Record<string, unknown> = {
        pageId,
        question: probe.question,
        channel: 'dm',
        source: 'eval',
    };
    if (probe.history) {
        body.conversationHistory = probe.history.flatMap(t => [
            ...(t.q ? [{ role: 'user', content: t.q }] : []),
            ...(t.a ? [{ role: 'assistant', content: t.a }] : []),
        ]);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(`${BASE_URL}/admin/ai/playground`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
            body: JSON.stringify(body),
        });
        if (res.ok) return await res.json() as PlaygroundResponse;
        // 429/5xx are transient at this concurrency; a hard failure would be
        // silently counted as "no fabrication" and flatter the result.
        if (![429, 500, 502, 503, 504].includes(res.status)) {
            console.error(`[${probe.id}] HTTP ${res.status}: ${await res.text()}`);
            return null;
        }
        await new Promise(r => setTimeout(r, [2000, 8000, 20000][attempt]));
    }
    console.error(`[${probe.id}] gave up after retries`);
    return null;
}

async function main(): Promise<void> {
    const pageId = await resolveDamascusPageId();
    const todayIso = new Date().toISOString().slice(0, 10);
    // The grounding SOURCE for this fixture page, per ARM: the baseline seed
    // created no collections, so its judging source is the prose KB alone.
    // NOT a mirror of buildGroundingSource — that function also carries
    // businessInfoBlock and (since 2026-08-19) the persona. This page has
    // neither, so the two agree HERE and only here.
    const kb = [
        DEMO_PAGES.find(p => p.facebookPageId === 'demo_page_damascus')!.suggestedKnowledgeBase,
        ...(ARM === 'slice' ? [renderDemoDamascusLists(todayIso, { schedulesUnkeyed: UNKEYED })] : []),
    ].filter(Boolean).join('\n\n');
    console.error(`ARM=${ARM}${UNKEYED ? ' (schedules UN-KEYED)' : ''}`);

    // PROBES=S9,C6 → run only those probes (prefix match on the id, so «S9» hits
    // «S9-sublevel-borrow»). Sampling one defect class plus its own control is the
    // normal shape of a before/after measurement, and a full battery costs 15×RUNS
    // replies — the filter keeps the cost proportional to the question being asked.
    // Never use it to report a battery result: a single-class run measures that
    // class only, and the summary below prints which probes actually ran.
    const only = (process.env.PROBES || '').split(',').map(s => s.trim()).filter(Boolean);
    const selected = only.length
        ? PROBES.filter(p => only.some(prefix => p.id.startsWith(prefix)))
        : PROBES;
    if (only.length && selected.length === 0) {
        throw new Error(`PROBES=${only.join(',')} matched nothing. Ids: ${PROBES.map(p => p.id).join(', ')}`);
    }

    const jobs = selected.flatMap(probe => Array.from({ length: RUNS }, (_, run) => ({ probe, run })));
    console.error(`Probing ${selected.length}${only.length ? ` of ${PROBES.length}` : ''} probes × ${RUNS} runs = ${jobs.length} replies (page ${pageId.slice(0, 8)}…)`);
    if (only.length) console.error(`PROBES filter: ${selected.map(p => p.id).join(', ')}`);

    const rows = await mapPool(jobs, CONCURRENCY, async ({ probe, run }) => {
        const resp = await ask(pageId, probe);
        const reply = resp?.data?.reply ?? resp?.reply ?? null;
        if (!reply) return null;
        const flags = resp?.data?.flags ?? resp?.flags ?? [];
        const row: DatasetRow = {
            id: `${probe.id}#${run + 1}`,
            page_name: `probe:${probe.kind}`,
            page_replies_30d: 1,
            kb_source: 'exact',
            kb,
            question: probe.question,
            reply,
            intent: resp?.data?.intent ?? resp?.intent ?? null,
            flag_reason: flags.length ? flags.join(',') : null,
            needs_attention: resp?.data?.needsAttention ?? resp?.needsAttention ?? null,
            created_at: new Date().toISOString(),
            history: probe.history ?? null,
        };
        return row;
    });

    const kept = rows.filter((r): r is DatasetRow => !!r);
    console.error(`Collected ${kept.length}/${jobs.length} replies`
        + ` (defect: ${kept.filter(r => r.page_name === 'probe:defect').length},`
        + ` control: ${kept.filter(r => r.page_name === 'probe:control').length})`);
    if (kept.length < jobs.length) {
        console.error('⚠️  Missing replies are NOT counted as clean — re-run before quoting a rate.');
    }

    reportStale(kept, todayIso);
    process.stdout.write(JSON.stringify(kept, null, 1));
}

// ── Judge 2: the deterministic stale-date report (stderr, per probe) ────────
function reportStale(kept: DatasetRow[], todayIso: string): void {
    console.error(`\nStale-date scan (today = ${todayIso}):`);
    const byProbe = new Map<string, DatasetRow[]>();
    for (const r of kept) {
        const probeId = r.id.slice(0, r.id.lastIndexOf('#'));
        byProbe.set(probeId, [...(byProbe.get(probeId) ?? []), r]);
    }
    for (const probe of PROBES) {
        const runs = byProbe.get(probe.id) ?? [];
        // A probe the PROBES filter excluded has no runs — print nothing rather
        // than «stale 0/0», which reads as a clean result for a probe that never ran.
        if (runs.length === 0) continue;
        const scans = runs.map(r => scanDates(r.reply, todayIso));
        const staleHits = scans.filter(s => s.stale.length > 0).length;
        const upcomingHits = scans.filter(s => s.upcoming.length > 0).length;
        if (probe.id === 'C1-upcoming-date') {
            // Positive control: MUST contain an upcoming date.
            console.error(`  ${probe.id}: upcoming-date present ${upcomingHits}/${runs.length}${upcomingHits < runs.length ? '  ⚠️ over-correction' : ''}${staleHits ? `  ⚠️ stale ${staleHits}` : ''}`);
        } else {
            console.error(`  ${probe.id}: stale ${staleHits}/${runs.length}${staleHits ? '  ❌' : ''}`);
        }
    }
}

async function rescan(path: string): Promise<void> {
    const { readFileSync } = await import('fs');
    const rows = JSON.parse(readFileSync(path, 'utf8')) as DatasetRow[];
    reportStale(rows, new Date().toISOString().slice(0, 10));
}

(RESCAN ? rescan(RESCAN) : main()).catch(err => {
    console.error(err);
    process.exit(1);
});
