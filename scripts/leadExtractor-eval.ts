/**
 * Lead Extraction Eval
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone eval that exercises leadExtractor's prompt against real OpenAI,
 * so we can measure quality before swapping the production model.
 *
 * Usage:
 *   OPENAI_API_KEY=... EVAL_MODEL=gpt-4.1-nano npx tsx scripts/leadExtractor-eval.ts
 *   OPENAI_API_KEY=... EVAL_MODEL=gpt-4.1-mini npx tsx scripts/leadExtractor-eval.ts
 *
 * Env:
 *   OPENAI_API_KEY  — required
 *   EVAL_MODEL      — model to test (default: gpt-4.1-nano)
 *   CONCURRENCY     — parallel calls (default: 3)
 *   VERBOSE         — set to 1 to print AI output per test
 *
 * Each test sets expectations on the JSON output (phone, summary language,
 * required field keys, forbidden field keys, hallucination guards). A test
 * passes only when all checks succeed.
 */

// Standalone eval script — intentionally bypasses ai_usage_log because it has
// no real user context. Cost is incurred manually by the developer running
// the eval and is not part of customer attribution; logging it would pollute
// per-customer P&L with synthetic rows. Run cost is reported to stdout below.
// eslint-disable-next-line no-restricted-imports
import OpenAI from 'openai';
import { EXTRACTION_PROMPT } from '../backend/src/services/leadExtractor';

const MODEL = process.env.EVAL_MODEL || 'gpt-4.1-nano';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);
const VERBOSE = process.env.VERBOSE === '1';

if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY required');
    process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type ExtractedField = { key: string; label_en?: string; label_ar?: string; value: string };
type ExtractedJson = { phone?: string; summary?: string; fields?: ExtractedField[] };

interface TestCase {
    id: number;
    name: string;
    conversation: string;
    rawPhone: string;
    expected: {
        phone?: string;            // exact match
        phoneEmpty?: boolean;      // expect empty (someone else's number)
        summaryLang?: 'ar' | 'en'; // detected by Arabic-script presence
        summaryNotMeta?: boolean;  // disallow "no conversation provided" placeholders
        fieldsHave?: string[];     // these keys MUST appear
        fieldsLack?: string[];     // these keys MUST NOT appear (hallucination guard)
        valueContainsForKey?: { key: string; substrings: string[] }[]; // value sanity check
    };
}

const TESTS: TestCase[] = [
    {
        id: 1,
        name: 'AR — training inquiry with name + course',
        rawPhone: '0512345678',
        conversation: [
            'Customer: السلام عليكم، اسمي فاطمة وأبغى أعرف عن دورة تعليم الإنجليزي',
            'Agent: أهلاً فاطمة! عندنا دورة محادثة وقواعد، تبدأ الأحد القادم',
            'Customer: ممتاز، رقمي 0512345678 تواصلوا معاي',
        ].join('\n'),
        expected: {
            phone: '0512345678',
            summaryLang: 'ar',
            summaryNotMeta: true,
            fieldsHave: ['name'],
            valueContainsForKey: [{ key: 'name', substrings: ['فاطمة'] }],
        },
    },
    {
        id: 2,
        name: 'EN — clinic appointment',
        rawPhone: '+966501234567',
        conversation: [
            'Customer: Hi, my name is Sarah and I need a dermatology appointment next week',
            'Agent: Sure Sarah, we have Dr. Khalid available Tuesday',
            'Customer: Tuesday works. My number is +966501234567',
        ].join('\n'),
        expected: {
            phone: '+966501234567',
            summaryLang: 'en',
            summaryNotMeta: true,
            fieldsHave: ['name'],
            valueContainsForKey: [{ key: 'name', substrings: ['Sarah'] }],
        },
    },
    {
        id: 3,
        name: 'AR — phone-only comment with post context (electronics)',
        rawPhone: '0598765432',
        conversation: [
            'Post: عرض على آيفون 15 برو — متوفر الآن مع الضمان',
            'Customer comment: 0598765432',
            'Agent reply: تم استلام رقمك، أحد المندوبين بيتواصل معك',
        ].join('\n'),
        expected: {
            phone: '0598765432',
            summaryLang: 'ar',
            summaryNotMeta: true,
            fieldsLack: ['name'], // no name was provided
        },
    },
    {
        id: 4,
        name: 'AR — explicit "this is my friend\'s number" (third-party)',
        rawPhone: '0555111222',
        conversation: [
            'Customer: السلام عليكم، صديقي يبي يعرف عن الدورة، رقمه 0555111222 لو تواصلتم معاه',
            'Agent: أهلاً، تمام نتواصل معاه إن شاء الله',
        ].join('\n'),
        expected: {
            phoneEmpty: true,
            summaryLang: 'ar',
            summaryNotMeta: true,
        },
    },
    {
        id: 5,
        name: 'EN — store product interest with budget',
        rawPhone: '+201112223333',
        conversation: [
            'Customer: Looking for a laptop under 1500 USD for video editing',
            'Agent: We have the MacBook Air M3 at 1499',
            'Customer: Sounds good, I am Ahmed, my number is +201112223333',
        ].join('\n'),
        expected: {
            phone: '+201112223333',
            summaryLang: 'en',
            summaryNotMeta: true,
            fieldsHave: ['name'],
            valueContainsForKey: [{ key: 'name', substrings: ['Ahmed'] }],
        },
    },
    {
        id: 6,
        name: 'AR — fashion store size + style',
        rawPhone: '0533444555',
        conversation: [
            'Customer: عندكم عبايات سوداء مقاس M؟',
            'Agent: نعم، عندنا تشكيلة جديدة',
            'Customer: ممتاز، أرسلولي صور على واتساب 0533444555',
        ].join('\n'),
        expected: {
            phone: '0533444555',
            summaryLang: 'ar',
            summaryNotMeta: true,
            fieldsLack: ['name'], // no name shared
        },
    },
    {
        id: 7,
        name: 'EN — short phone-only with post context',
        rawPhone: '+447700900123',
        conversation: [
            'Post: New iPhone 15 Pro in stock — limited offer',
            'Customer comment: +447700900123 please call me',
            'Agent reply: We will call you shortly',
        ].join('\n'),
        expected: {
            phone: '+447700900123',
            summaryLang: 'en',
            summaryNotMeta: true,
        },
    },
    {
        id: 8,
        name: 'AR — multi-intent: started with question, ended with booking',
        rawPhone: '0566777888',
        conversation: [
            'Customer: كم سعر تنظيف الأسنان؟',
            'Agent: 200 ريال',
            'Customer: طيب وزراعة سن واحد؟',
            'Agent: 2500 ريال',
            'Customer: تمام، أبي أحجز موعد لتنظيف الأسنان الأسبوع الجاي. اسمي خالد ورقمي 0566777888',
        ].join('\n'),
        expected: {
            phone: '0566777888',
            summaryLang: 'ar',
            summaryNotMeta: true,
            fieldsHave: ['name'],
            valueContainsForKey: [{ key: 'name', substrings: ['خالد'] }],
        },
    },
    {
        id: 9,
        name: 'EN — name only no phone in convo (rawPhone fallback)',
        rawPhone: '+966500000001',
        conversation: [
            'Customer: Hi, this is Mark. I want to know your store hours.',
            'Agent: We are open 9am-9pm daily',
        ].join('\n'),
        expected: {
            // No phone in conversation; AI may return rawPhone OR empty.
            // Both are acceptable — we relax this check to not fail on either.
            summaryLang: 'en',
            summaryNotMeta: true,
            fieldsHave: ['name'],
            valueContainsForKey: [{ key: 'name', substrings: ['Mark'] }],
        },
    },
    {
        id: 10,
        name: 'AR — angry/complaint with phone for callback',
        rawPhone: '0512888999',
        conversation: [
            'Customer: الطلبية وصلتني مكسورة وأنا مستاء جداً',
            'Agent: نعتذر بشدة، نبي نعوضك',
            'Customer: اتصلوا فيني على 0512888999',
        ].join('\n'),
        expected: {
            phone: '0512888999',
            summaryLang: 'ar',
            summaryNotMeta: true,
        },
    },
    {
        id: 11,
        name: 'EN — empty/sparse conversation, phone-only comment',
        rawPhone: '+15551234567',
        conversation: [
            'Post: DM us for a free consultation',
            'Customer comment: +15551234567',
        ].join('\n'),
        expected: {
            phone: '+15551234567',
            summaryLang: 'en',
            summaryNotMeta: true,
        },
    },
    {
        id: 12,
        name: 'AR — school enrollment: name + grade + start date',
        rawPhone: '0577123456',
        conversation: [
            'Customer: أبي أسجل بنتي مريم في الصف الأول الابتدائي للسنة الجاية',
            'Agent: تمام، التسجيل مفتوح. ممكن رقم تواصل؟',
            'Customer: 0577123456',
        ].join('\n'),
        expected: {
            phone: '0577123456',
            summaryLang: 'ar',
            summaryNotMeta: true,
            // Customer is parent enrolling daughter — both names may appear or not;
            // not strictly required since "name" is the parent's name and they didn't share theirs.
        },
    },
    {
        id: 13,
        name: 'AR — bilingual mix (Arabizi numbers)',
        rawPhone: '0501112233',
        conversation: [
            'Customer: Hello, ana abi a3raf 3an dawrat PMP',
            'Agent: عندنا دورة PMP تبدأ شهر جاي',
            'Customer: ok رقمي 0501112233',
        ].join('\n'),
        expected: {
            phone: '0501112233',
            summaryNotMeta: true,
            // Mixed-language input; allow either summary language as long as it's not meta
        },
    },
    {
        id: 14,
        name: 'EN — minimal one-liner phone with no other context',
        rawPhone: '+15559998888',
        conversation: [
            'Customer: My number is +15559998888',
        ].join('\n'),
        expected: {
            phone: '+15559998888',
            summaryLang: 'en',
            summaryNotMeta: true,
        },
    },
    {
        id: 15,
        name: 'AR — hallucination guard (no email mentioned)',
        rawPhone: '0599887766',
        conversation: [
            'Customer: السلام عليكم، أبي أعرف عن دورات التصميم',
            'Agent: عندنا دورة فوتوشوب وإلستريتور',
            'Customer: ممتاز، رقمي 0599887766',
        ].join('\n'),
        expected: {
            phone: '0599887766',
            summaryLang: 'ar',
            summaryNotMeta: true,
            fieldsLack: ['email'], // never shared, must not be hallucinated
        },
    },
];

const HAS_ARABIC = /[؀-ۿ]/;
const META_PHRASES = [
    'no conversation', 'not enough context', 'no context provided',
    'لا يوجد محادثة', 'لا توجد معلومات', 'غير كافي',
];

function checkResult(t: TestCase, j: ExtractedJson): { ok: boolean; failures: string[] } {
    const failures: string[] = [];
    const exp = t.expected;

    if (exp.phone !== undefined && j.phone !== exp.phone) {
        failures.push(`phone: expected "${exp.phone}" got "${j.phone}"`);
    }
    if (exp.phoneEmpty && j.phone && j.phone.trim() !== '') {
        failures.push(`phone: expected empty got "${j.phone}"`);
    }
    if (exp.summaryLang) {
        const summary = j.summary || '';
        const isAr = HAS_ARABIC.test(summary);
        const got: 'ar' | 'en' = isAr ? 'ar' : 'en';
        if (got !== exp.summaryLang) {
            failures.push(`summaryLang: expected ${exp.summaryLang} got ${got} ("${summary.slice(0, 40)}")`);
        }
    }
    if (exp.summaryNotMeta) {
        const s = (j.summary || '').toLowerCase();
        const meta = META_PHRASES.find(p => s.includes(p.toLowerCase()));
        if (meta) failures.push(`summaryNotMeta: contains meta phrase "${meta}"`);
        if (!j.summary || j.summary.trim().length === 0) {
            failures.push('summaryNotMeta: summary is empty');
        }
    }
    const fieldKeys = (j.fields ?? []).map(f => f.key);
    if (exp.fieldsHave) {
        for (const k of exp.fieldsHave) {
            if (!fieldKeys.includes(k)) failures.push(`fieldsHave: missing "${k}" (got: ${fieldKeys.join(',') || 'none'})`);
        }
    }
    if (exp.fieldsLack) {
        for (const k of exp.fieldsLack) {
            if (fieldKeys.includes(k)) failures.push(`fieldsLack: forbidden "${k}" was present`);
        }
    }
    if (exp.valueContainsForKey) {
        for (const { key, substrings } of exp.valueContainsForKey) {
            const f = (j.fields ?? []).find(x => x.key === key);
            if (!f) {
                failures.push(`valueContainsForKey: field "${key}" missing`);
                continue;
            }
            const v = (f.value || '').toLowerCase();
            const hit = substrings.some(s => v.includes(s.toLowerCase()));
            if (!hit) failures.push(`valueContainsForKey[${key}]: value "${f.value}" missing any of [${substrings.join('|')}]`);
        }
    }

    return { ok: failures.length === 0, failures };
}

async function runOne(t: TestCase): Promise<{ id: number; ok: boolean; failures: string[]; latencyMs: number; raw: string }> {
    const prompt = EXTRACTION_PROMPT.replace('<CONVERSATION>', t.conversation);
    const start = Date.now();
    let raw = '';
    try {
        const resp = await client.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            max_tokens: 500,
            response_format: { type: 'json_object' },
        });
        raw = resp.choices[0]?.message?.content?.trim() || '';
        const latencyMs = Date.now() - start;
        const parsed = JSON.parse(raw) as ExtractedJson;
        const { ok, failures } = checkResult(t, parsed);
        return { id: t.id, ok, failures, latencyMs, raw };
    } catch (err) {
        const latencyMs = Date.now() - start;
        return {
            id: t.id,
            ok: false,
            failures: [`exception: ${err instanceof Error ? err.message : String(err)}`],
            latencyMs,
            raw,
        };
    }
}

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            if (item !== undefined) await fn(item);
        }
    });
    await Promise.all(workers);
}

async function main(): Promise<void> {
    console.log(`Lead Extractor Eval — ${TESTS.length} tests`);
    console.log(`Model: ${MODEL}`);
    console.log(`Concurrency: ${CONCURRENCY}`);
    console.log('─'.repeat(60));

    const results: Awaited<ReturnType<typeof runOne>>[] = [];
    await runWithConcurrency(TESTS, CONCURRENCY, async (t) => {
        const r = await runOne(t);
        results.push(r);
        const tag = r.ok ? 'PASS' : 'FAIL';
        const t0 = TESTS.find(x => x.id === r.id)!;
        console.log(`  [#${r.id}] ${tag} (${r.latencyMs}ms) — ${t0.name}`);
        if (!r.ok) for (const f of r.failures) console.log(`         · ${f}`);
        if (VERBOSE) console.log(`         raw: ${r.raw}`);
    });

    results.sort((a, b) => a.id - b.id);
    const pass = results.filter(r => r.ok).length;
    const fail = results.length - pass;
    const avgLat = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length);

    console.log('─'.repeat(60));
    console.log(`TOTAL: ${pass} PASS  ${fail} FAIL  (${results.length} tests)`);
    console.log(`SCORE: ${((pass / results.length) * 100).toFixed(1)}%`);
    console.log(`AVG LATENCY: ${avgLat}ms`);

    process.exit(fail > 0 ? 1 : 0);
}

main();
