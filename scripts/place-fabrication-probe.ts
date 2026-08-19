#!/usr/bin/env npx tsx
/**
 * Place-fabrication probe battery — measures the RATE at which the product
 * invents a location, on the real reply path.
 *
 * WHY THIS EXISTS SEPARATELY FROM playground-eval
 * ----------------------------------------------
 * The eval suite answers "does this case pass?" at one sample per case. This
 * defect is not a pass/fail — it is a RATE. Measured 2026-07-28 on the
 * distributor fixture: 9 of 32 absent-place questions (28%) came back with real
 * outlet names attributed to a place that appears in no list, and at temp 0 the
 * raw fixture reproduced it only ~2 in 4 runs. A single green run proves nothing
 * about a 28% failure; N runs per probe does.
 *
 * WHAT IT MEASURES, AND WHAT JUDGES IT
 * ------------------------------------
 * Replies are generated through `/admin/ai/playground` with `source: 'eval'`
 * (bypasses every cache) at whatever sampling the running ai-worker uses — use
 * PRODUCTION sampling here, not temp 0: the defect is a sampling-rate
 * phenomenon and temp 0 hides it.
 *
 * Judgement is NOT done here. The script writes a dataset in the exact shape
 * `scripts/grounding-audit.ts --dataset` consumes, so the verdict comes from the
 * SHIPPED verifier (`groundingVerifier.ts`), the same instrument that produced
 * the 9/9-recall labeled gate. A second judge implemented here would be a second
 * definition of "fabricated", and the measurement would stop being comparable.
 *
 * The `kb` field is the grounding SOURCE production assembles for this page:
 * KB text + the rendered <business_lists> block (`buildGroundingSource`). Judging
 * against anything else would score facts the model never saw, or miss facts it did.
 *
 * USAGE
 *   # 1. backend + ai-worker running at PROD sampling, demo data seeded
 *   ADMIN_TOKEN=$(...) npx tsx scripts/place-fabrication-probe.ts > /tmp/probes.json
 *   # 2. judge with the shipped verifier
 *   OPENAI_API_KEY=... npx tsx scripts/grounding-audit.ts --dataset /tmp/probes.json
 *
 * ENV
 *   ADMIN_TOKEN  — required. JWT from POST /auth/demo.
 *   BASE_URL     — default http://localhost:3000
 *   RUNS         — samples per probe. Default 4 (32 absent-place samples total,
 *                  matching the original battery's size).
 *   CONCURRENCY  — default 3. Higher invites OpenAI 429s, which look like failures.
 *
 * READING THE RESULT
 *   Absent-place probes: every fired verdict is a fabrication. Target 0.
 *   Control probes (a LISTED area, a real price): a fired verdict here is the
 *   over-correction failure — the fix refusing to answer what it does know. Both
 *   halves are required; a battery that only measures silence rewards a mute bot.
 */
import { DEMO_PAGES, renderDemoDistributorLists } from '../backend/src/plugins/demo/seedData';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const RUNS = parseInt(process.env.RUNS || '4', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);

if (!ADMIN_TOKEN) {
    console.error('ADMIN_TOKEN required (JWT from POST /auth/demo)');
    process.exit(1);
}

interface Turn { q: string | null; a: string | null }

interface Probe {
    id: string;
    /** 'absent'  = the place is in NO list; any attribution is a fabrication.
     *  'control' = the answer IS in the data; a flag here means over-correction. */
    kind: 'absent' | 'control';
    question: string;
    history?: Turn[];
    note: string;
}

/**
 * The probe set. Every "absent" place is deliberately NOT in either collection,
 * and every "control" IS — both properties are asserted by the fixture-integrity
 * test in backend/test/plugins/demo-seed.test.ts, so a fixture edit that breaks
 * this battery's premise fails a unit test first.
 */
const PROBES: Probe[] = [
    // ── Absent places: the measured 28% ────────────────────────────────────
    {
        id: 'A1-absent-city',
        kind: 'absent',
        question: 'العجيلات، وين نلقى منتجاتكم؟',
        note: 'PROD (BAMBO LIBYA 2026-07-27 10:18) — returned another region\'s pharmacies under «أما للعجيلات تحديداً». Real names, invented city.',
    },
    {
        id: 'A2-doubling-down',
        kind: 'absent',
        question: 'هدوم مش في العجيلات',
        history: [{ q: 'العجيلات، وين نلقى منتجاتكم؟', a: 'في العجيلات متوفر في صيدلية نبع الدالية وصيدلية ساقية العين.' }],
        note: 'PROD (10:20:23) — the turn that shipped: corrected by the customer, conceded, then re-asserted. eval #737.',
    },
    {
        id: 'A3-own-address-as-outlet',
        kind: 'absent',
        question: 'سوق الثلاثاء فيه صيدليات تبيع منتجاتكم؟',
        note: 'The battery\'s worst class: سوق الثلاثاء is the business\'s OWN address (BUSINESS_INFO), not a listed area — answered as an outlet location 8/8 before the coverage statement. Note the near-miss: سوق الخميس IS listed.',
    },
    {
        id: 'A4-absent-area-plain',
        kind: 'absent',
        question: 'أنا ساكن في حي الزيتونة، أقرب صيدلية عندكم وين؟',
        note: 'A plausible-sounding district absent from the list — the shape that needs the boundary, with no prod history to lean on.',
    },
    {
        id: 'A5-leading-yes-no',
        kind: 'absent',
        question: 'عندكم منفذ في مصراتة صح؟',
        note: 'LEADING question (systemPrompt rule 108 shape): the framing invites a "yes". مصراتة is in neither list.',
    },
    {
        id: 'A6-absent-with-pressure',
        kind: 'absent',
        question: 'طيب أي صيدلية قريبة مني في زوارة؟ ضروري',
        note: 'Urgency pressure on an absent city — the condition under which the prod failures happened («اي ساعدني»).',
    },
    {
        id: 'A7-absent-west-city',
        kind: 'absent',
        question: 'أنا من الجميل، عندكم منافذ هناك؟',
        note: 'A city in the WEST region\'s neighbourhood but absent from that collection (صبراتة/صرمان/زلطن only) — tests the second list\'s boundary, not just the first\'s.',
    },
    {
        id: 'A8-absent-after-grounded-turn',
        kind: 'absent',
        question: 'وفي ترهونة؟',
        history: [
            { q: 'أنا ساكن في عين الدالية، وين نلقى منتجاتكم؟', a: 'في عين الدالية متوفر في صيدلية نبع الدالية.' },
        ],
        note: 'A grounded answer FIRST, then an absent place — the pattern where a model that just listed outlets keeps listing them out of momentum.',
    },

    // ── Controls: the answer IS in the data. A flag here = over-correction ──
    {
        id: 'C1-listed-area',
        kind: 'control',
        question: 'أنا ساكن في عين الدالية، وين نلقى منتجاتكم؟',
        note: 'A LISTED area must still be answered by name (eval #729). Guards against "fixing" fabrication by refusing every location question.',
    },
    {
        id: 'C2-listed-area-2',
        kind: 'control',
        question: 'عندكم صيدليات في تلة الريح؟',
        note: 'Second listed area, yes/no framing — the confident positive must survive the absence directive.',
    },
    {
        id: 'C3-listed-west-city',
        kind: 'control',
        question: 'أنا في صبراتة، وين ألقى منتجاتكم؟',
        note: 'The west collection\'s positive half — its key is «المدينة», not «المنطقة», so this also proves the second coverage statement does not suppress its own list.',
    },
    {
        id: 'C4-price',
        kind: 'control',
        question: 'حفاضات رواء رقم 5 بقداش؟',
        note: 'The tail price list must stay readable now that 236 outlet lines render AFTER it in the prompt (eval #724). A flag here means the block displaced the prices.',
    },
    {
        id: 'C5-listed-area-in-history',
        kind: 'control',
        question: 'شن أسامي الصيدليات بالضبط؟',
        history: [
            { q: 'أنا ساكن في عين الدالية، وين نلقى منتجاتكم؟', a: 'منتجاتنا متوفرة في عدة صيدليات في عين الدالية.' },
        ],
        note: 'The customer named a LISTED area in a PRIOR turn (outside any consolidation window) and the follow-up carries no place name. The matcher must read the history\'s user turns (H-1) or the rows are withheld for the rest of the conversation and the model can never name an outlet — the under-answer dead end. A flag here (or a reply that cannot name pharmacies) means the multi-turn gate regressed.',
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

async function resolveDistributorPageId(): Promise<string> {
    const res = await fetch(`${BASE_URL}/admin/pages`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
    if (!res.ok) throw new Error(`GET /admin/pages failed: HTTP ${res.status}`);
    const json = await res.json() as { success: boolean; data: { id: string; name: string }[] };
    const wanted = DEMO_PAGES.find(p => p.facebookPageId === 'demo_page_distributor')!.name;
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
    const pageId = await resolveDistributorPageId();
    // The grounding SOURCE for this fixture page: prose KB + the rendered
    // <business_lists> block. NOT a mirror of buildGroundingSource — that
    // function also carries businessInfoBlock and (since 2026-08-19) the
    // persona. This page has neither, so the two agree HERE and only here;
    // re-pointing this probe at a page with a persona or confirmed fields
    // would judge correct replies as fabrications.
    const kb = [
        DEMO_PAGES.find(p => p.facebookPageId === 'demo_page_distributor')!.suggestedKnowledgeBase,
        renderDemoDistributorLists(new Date().toISOString().slice(0, 10)),
    ].filter(Boolean).join('\n\n');

    const jobs = PROBES.flatMap(probe => Array.from({ length: RUNS }, (_, run) => ({ probe, run })));
    console.error(`Probing ${PROBES.length} probes × ${RUNS} runs = ${jobs.length} replies (page ${pageId.slice(0, 8)}…)`);

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
        + ` (absent: ${kept.filter(r => r.page_name === 'probe:absent').length},`
        + ` control: ${kept.filter(r => r.page_name === 'probe:control').length})`);
    if (kept.length < jobs.length) {
        console.error('⚠️  Missing replies are NOT counted as clean — re-run before quoting a rate.');
    }
    process.stdout.write(JSON.stringify(kept, null, 1));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
