#!/usr/bin/env npx tsx
/**
 * Grounding audit — measures a candidate reply-groundedness verifier BEFORE any
 * of it goes near the reply pipeline.
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SCRIPT EXISTS
 *
 * The reply pipeline enforces grounding for exactly ONE thing: numbers
 * (`flagHallucinatedPrice`, Check 1 in ai-worker/src/services/reply/replyValidator.ts).
 * Every other claim — a place, a branch, a product name, a policy, a payment
 * method, a "yes we cover that" — is governed by prompt rules only, and prompt
 * rules are advisory. SYSTEM_ANALYSIS gap 13 is the live consequence: BAMBO
 * LIBYA was asked about العجيلات (absent from the KB), answered with real
 * pharmacy names attributed to that city, doubled down when corrected, and
 * nothing flagged.
 *
 * A first fix — a model SELF-REPORT (`place_claims`) verified against the KB —
 * was built and REJECTED on measurement (2026-07-28): across ~1,690 scored eval
 * tests the flag fired once, and that once was a false positive on an honest
 * denial, while the case that reproduces the defect (#737) fired it zero times.
 * The generator stops self-reporting precisely when it is defending a wrong
 * claim. The recorded conclusion: detection must read the REPLY TEXT against
 * the KB, and must be measured on real traffic — the eval suite contains ~2
 * instances of this defect in 1,690 tests, which is far too thin to tune on.
 *
 * So this script measures a candidate verifier, and ships nothing:
 *   • no prompt-version bump      → no fleet-wide semantic-cache flush
 *   • no required schema field    → no change to any production AI call
 *   • no hot-path code            → no latency, no failure mode, no rollback
 *
 * THE CANDIDATE: an INDEPENDENT verifier call that sees only (business info,
 * customer message, reply) and judges support. Unlike the rejected self-report
 * it is not the generator grading its own answer under persona pressure — it is
 * a separate entailment task, the standard RAG-faithfulness shape.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MODES
 *
 *   labeled  (default) — run the built-in labeled set: documented prod
 *                        fabrications as positives, and the reply shapes that
 *                        MUST NOT flag (honest denials, correct arithmetic,
 *                        grounded outlet lists) as negatives. Gives precision /
 *                        recall in ~30 seconds for ~$0.02, with no prod access.
 *
 *   dataset  — score a sample of REAL production replies exported with
 *              `--print-sql`. This is the number the last attempt never had:
 *              how often the guard fires on ordinary traffic, and how much of
 *              that is new (not already caught by price_not_in_kb /
 *              info_not_in_kb). Writes every firing to a review file so the
 *              false-positive rate can be adjudicated by reading, not guessed.
 *
 * USAGE
 *   OPENAI_API_KEY=... npx tsx scripts/grounding-audit.ts
 *   OPENAI_API_KEY=... npx tsx scripts/grounding-audit.ts --dataset sample.json
 *   npx tsx scripts/grounding-audit.ts --print-sql          # prod export SQL
 *
 * EXPORTING THE PROD SAMPLE (read-only)
 *   npx tsx scripts/grounding-audit.ts --print-coverage-sql > /tmp/ga-cov.sql
 *   ./scripts/prod-db-query.sh --file /tmp/ga-cov.sql        # what the sample omits
 *   npx tsx scripts/grounding-audit.ts --print-sql > /tmp/ga.sql
 *   PSQL_ARGS=-At ./scripts/prod-db-query.sh --file /tmp/ga.sql > /tmp/sample.json
 *
 *   The export deliberately keeps ONLY replies whose page has not changed its
 *   KB since — `messages.created_at >= ingestion time of the page's CURRENT
 *   kb_active_version` — so `pages.knowledge_base` IS the text the model saw.
 *   Scoring a reply against a KB it never had is the exact timeline error that
 *   produced (and retracted) the "buried facts" diagnosis; this filter makes it
 *   impossible rather than something to remember. The COVERAGE query printed
 *   alongside reports how many replies that filter drops, so the sample is
 *   never mistaken for the whole fleet.
 *
 * ENV
 *   OPENAI_API_KEY     — required (except for --print-sql)
 *   GROUNDING_MODEL    — verifier model. Default: gpt-4.1-mini
 *   CONCURRENCY        — parallel verifier calls. Default: 4
 *   MERCHANT_EMAILS    — comma-separated accounts to sample. Default: the four
 *                        that matter (see MERCHANT_EMAILS below). "*" = fleet.
 *   PER_PAGE           — replies sampled per page. Default: 40
 *   VERBOSE            — 1 to print every case verdict, not just failures
 */

// Standalone measurement script — intentionally bypasses ai_usage_log: it has
// no user context, and synthetic rows would pollute per-customer P&L. Run cost
// is reported to stdout instead (same posture as scripts/leadExtractor-eval.ts).
// eslint-disable-next-line no-restricted-imports
import OpenAI from 'openai';
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEMO_PAGES, renderDemoDistributorLists } from '../backend/src/plugins/demo/seedData';
import { estimateCostUsd } from '../backend/src/config/aiPricing';
import {
    GROUNDING_VERIFIER_PROMPT,
    GROUNDING_VERDICT_SCHEMA,
    type UnsupportedClaim,
} from '../backend/src/services/groundingVerifier';

interface Verdict {
    verdict: 'grounded' | 'unsupported';
    unsupported_claims: UnsupportedClaim[];
}

const MODEL = process.env.GROUNDING_MODEL || 'gpt-4.1-mini';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '4', 10);
const VERBOSE = process.env.VERBOSE === '1';

// ---------------------------------------------------------------------------
// The candidate verifier
// ---------------------------------------------------------------------------

// The prompt, the claim shape and the verdict schema now live in the SHIPPED
// service (backend/src/services/groundingVerifier.ts) and are imported here, so
// the harness can never measure a prompt that differs from the one in production
// — the same posture as scripts/leadExtractor-eval.ts importing EXTRACTION_PROMPT.
// This file keeps only what is measurement-specific: the labeled set, the prod
// export SQL, and the scoring report.

interface Turn { q: string | null; a: string | null }

interface VerifyInput {
    kb: string;
    question: string;
    reply: string;
    history?: Turn[];
}

interface VerifyResult extends Verdict {
    tokensIn: number;
    tokensOut: number;
    cachedIn: number;
    costUsd: number;
}

let client: OpenAI;

async function verifyGrounding(input: VerifyInput): Promise<VerifyResult> {
    const conversation = (input.history || [])
        .filter(t => t.q || t.a)
        .map(t => [t.q && `customer: ${t.q}`, t.a && `assistant: ${t.a}`].filter(Boolean).join('\n'))
        .join('\n');

    // business_info goes FIRST and unchanged so the prefix is identical for every
    // reply on the same page — that is what makes prompt caching (and therefore
    // the production cost of this check) acceptable. Do not interleave per-reply
    // text above it.
    const user = [
        `<business_info>\n${input.kb}\n</business_info>`,
        conversation ? `<conversation>\n${conversation}\n</conversation>` : '',
        `<customer_message>\n${input.question}\n</customer_message>`,
        `<reply>\n${input.reply}\n</reply>`,
    ].filter(Boolean).join('\n\n');

    const res = await client.chat.completions.create({
        model: MODEL,
        // The gpt-5 family rejects any temperature but its default ("Unsupported
        // value: 'temperature' does not support 0 with this model"), so the
        // determinism knob is simply absent there — a comparison run against a
        // gpt-5 model is inherently noisier than a 4.1 one, not equivalent to it.
        ...(MODEL.startsWith('gpt-5') ? {} : { temperature: 0 }),
        messages: [
            { role: 'system', content: GROUNDING_VERIFIER_PROMPT },
            { role: 'user', content: user },
        ],
        response_format: {
            type: 'json_schema',
            json_schema: { name: 'grounding_verdict', strict: true, schema: GROUNDING_VERDICT_SCHEMA },
        },
    });

    const parsed = JSON.parse(res.choices[0]?.message?.content || '{"verdict":"grounded","unsupported_claims":[]}') as Verdict;
    const tokensIn = res.usage?.prompt_tokens ?? 0;
    const tokensOut = res.usage?.completion_tokens ?? 0;
    const cachedIn = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
        // A verdict of "unsupported" with no claims is a non-answer; treat the
        // claims array as authoritative so downstream counting can't drift.
        verdict: parsed.unsupported_claims?.length ? 'unsupported' : 'grounded',
        unsupported_claims: parsed.unsupported_claims || [],
        tokensIn,
        tokensOut,
        cachedIn,
        costUsd: estimateCostUsd(MODEL, tokensIn, tokensOut, cachedIn),
    };
}

// ---------------------------------------------------------------------------
// Labeled set
// ---------------------------------------------------------------------------

/** The distributor demo fixture — an anonymized replica of the real BAMBO LIBYA
 *  KB that produced the fabrication: 236 outlet entries across many districts, a
 *  separate "west of the city" list, per-PACK prices only, and العجيلات
 *  deliberately absent from both lists. Imported rather than copied so the
 *  labeled set can never drift from the eval fixture (playground-eval `distributor`).
 *
 *  G1a (2026-07-28): the outlets now live in fact_collections, so the grounding
 *  SOURCE is KB text + the rendered <business_lists> block — exactly what
 *  `buildGroundingSource` hands the shipped verifier in production. Reading only
 *  the KB text here would hide 236 facts the model saw and flag every correct
 *  outlet answer as invented (N2/N3 are precisely those cases). */
const DISTRIBUTOR_KB = [
    DEMO_PAGES.find(p => p.facebookPageId === 'demo_page_distributor')!.suggestedKnowledgeBase,
    renderDemoDistributorLists(new Date().toISOString().slice(0, 10)),
].filter(Boolean).join('\n\n');

/** A 1+1 bundle offer — the shape behind the Nourva 640-instead-of-320 loss:
 *  160 buys TWO pieces, and reading it as a per-piece price passes the numeric
 *  guard because 160 is literally in the KB and 160×4=640 adds up. Check 1 is
 *  structurally blind to it; the verifier is the first thing that could see it. */
const BUNDLE_KB = `عرض خاص على كريم الأساس
قطعتين بسعر قطعة واحدة فقط! السعر الآن: 160 دينار
التوصيل داخل المدينة 10 دينار.
`;

interface LabeledCase {
    id: string;
    /** 'unsupported' = a fabrication the guard MUST catch (recall).
     *  'grounded'    = a reply the guard MUST NOT flag (precision). */
    expect: 'grounded' | 'unsupported';
    kb: string;
    question: string;
    reply: string;
    history?: Turn[];
    /** Provenance — a real incident, or the reply shape it protects. */
    note: string;
}

const LABELED_CASES: LabeledCase[] = [
    // ── Positives: fabrications that reached real customers, or their shape ──
    {
        id: 'P1-region-attribution',
        expect: 'unsupported',
        kb: DISTRIBUTOR_KB,
        question: 'العجيلات، وين نلقى منتجاتكم؟',
        reply: 'أما للعجيلات تحديداً فهذه هي الصيدليات المتوفرة: صيدلية نبع الدالية، صيدلية ساقية العين، صيدلية جدول الصفاء.',
        note: 'PROD (BAMBO LIBYA, 2026-07-27 10:18) — real pharmacy names, city invented. Every string is in the KB; the ATTRIBUTION is not. Check 1 passed it: no number.',
    },
    {
        id: 'P2-doubling-down',
        expect: 'unsupported',
        kb: DISTRIBUTOR_KB,
        question: 'هدوم مش في العجيلات',
        history: [{ q: 'العجيلات، وين نلقى منتجاتكم؟', a: 'في العجيلات متوفر في صيدلية نبع الدالية وصيدلية ساقية العين.' }],
        reply: 'أعتذر، الصيدليات في مناطق مختلفة. لكن المتوفرة في العجيلات هي صيدلية نبع الدالية وصيدلية ساقية العين.',
        note: 'PROD (10:20:23) — the turn that actually shipped: conceded, then re-asserted. eval #737. The rejected self-report guard reported NO claim here.',
    },
    {
        id: 'P3-invented-unit-price',
        expect: 'unsupported',
        kb: DISTRIBUTOR_KB,
        question: 'نعم',
        history: [{ q: 'نبي حفاضات رواء رقم 5', a: 'حفاضات رواء رقم 5 متوفرة، العلبة 22 قطعة بسعر 45 دينار.' }],
        reply: 'باكو واحد من حفاضات رواء رقم 5 سعره 1200 دينار ليبي.',
        note: 'PROD (10:16) — invented number on a purchase turn. Also caught by Check 1 since e5313a4c; kept so the verifier is not measured as WEAKER than what already ships.',
    },
    {
        id: 'P4-bundle-unit-laundering',
        expect: 'unsupported',
        kb: BUNDLE_KB,
        question: 'تمام نبي أربع قطع',
        reply: 'ممتاز! أربع قطع من كريم الأساس، السعر الإجمالي 640 دينار.',
        note: 'PROD (Nourva, 2026-07-23) — 160 buys TWO. Correct answer 320. Check 1 verifies the arithmetic and passes it; this is the class the numeric guard cannot see.',
    },
    {
        id: 'P5-invented-outlet-name',
        expect: 'unsupported',
        kb: DISTRIBUTOR_KB,
        question: 'أنا في عين الدالية، وين ألقى منتجاتكم؟',
        reply: 'في عين الدالية متوفر في صيدلية نبع الدالية وصيدلية الشفاء الحديثة وصيدلية النخيل الكبرى.',
        note: 'Right district, two invented pharmacy names mixed into a real list. The subtle shape — a merchant skimming the reply sees a correct answer.',
    },
    {
        id: 'P6-invented-coverage',
        expect: 'unsupported',
        kb: DISTRIBUTOR_KB,
        question: 'توصلون لطبرق؟',
        reply: 'نعم نوصل لطبرق، التوصيل يستغرق يومين إلى ثلاثة أيام.',
        note: 'Coverage + a delivery time, neither in the KB. The leading-question shape the prompt warns about (systemPrompt rule 108) but cannot enforce.',
    },
    {
        id: 'P7-invented-payment-method',
        expect: 'unsupported',
        kb: DISTRIBUTOR_KB,
        question: 'ممكن أدفع بالتقسيط؟',
        reply: 'أكيد، تقدر تدفع على ثلاث دفعات شهرية بدون فوائد.',
        note: 'Payment terms are named in the prompt as a never-invent class; nothing in the pipeline checks them.',
    },
    {
        id: 'P8-invented-variant',
        expect: 'unsupported',
        kb: DISTRIBUTOR_KB,
        question: 'عندكم رقم 7؟',
        reply: 'نعم متوفر رقم 7 للأوزان فوق 20 كيلو، العلبة 18 قطعة.',
        note: 'The KB stops at رقم 6. The defect is the CONFIRMATION of a variant that does not exist — Check 1 can only ever see the invented 18, never the invented product.',
    },
    {
        id: 'P9-invented-hours',
        expect: 'unsupported',
        kb: DISTRIBUTOR_KB,
        question: 'مفتوحين يوم الجمعة بالليل؟',
        reply: 'نعم، يوم الجمعة نفتح من 09:00 حتى 22:00.',
        note: 'KB says 09:00-17:00 every day. A plausible-sounding extension of a real fact — the hardest kind for a merchant to spot.',
    },

    // ── Negatives: correct behaviour that MUST survive ──────────────────────
    {
        id: 'N1-honest-denial',
        expect: 'grounded',
        kb: DISTRIBUTOR_KB,
        question: 'هل عندكم صيدلية في مصراتة؟',
        reply: 'للأسف ما عندي معلومة عن صيدليات في مصراتة. تقدر تتواصل معنا على +218910000001 ونساعدك.',
        note: 'THE false positive that killed the previous guard — its only firing across four eval suites. If this flags, the candidate is dead on arrival.',
    },
    {
        id: 'N2-grounded-denial-plus-alternative',
        expect: 'grounded',
        kb: DISTRIBUTOR_KB,
        question: 'العجيلات، وين نلقى منتجاتكم؟',
        reply: 'العجيلات مش موجودة في قائمتي للأسف. أقرب المناطق اللي عندنا فيها صيدليات هي صبراتة — صيدلية الميناء الأثري وصيدلية قوس المسرح.',
        note: 'The CORRECT answer to P1: deny the city, offer a listed region by name. The hardest negative — it repeats العجيلات and lists pharmacies in the same breath.',
    },
    {
        id: 'N3-grounded-outlet-list',
        expect: 'grounded',
        kb: DISTRIBUTOR_KB,
        question: 'أنا ساكن في عين الدالية، وين نلقى منتجاتكم؟',
        reply: 'في عين الدالية تلقى منتجاتنا في صيدلية نبع الدالية وصيدلية ساقية العين وصيدلية بئر الروضة.',
        note: 'eval #729 — the green guard. The fix must be "stop fabricating", never "stop answering".',
    },
    {
        id: 'N4-grounded-price',
        expect: 'grounded',
        kb: DISTRIBUTOR_KB,
        question: 'بقداش رقم 5؟',
        reply: 'حفاضات رواء رقم 5 — العلبة فيها 22 قطعة بسعر 45 دينار.',
        note: 'Verbatim KB fact.',
    },
    {
        id: 'N5-correct-arithmetic',
        expect: 'grounded',
        kb: DISTRIBUTOR_KB,
        question: 'نبي باكوين رقم 5، كم المجموع؟',
        reply: 'باكوين من رقم 5 = 90 دينار.',
        note: 'Derived, not literal. A verifier that demands literal presence flags this — and the price_math machinery exists precisely because merchants need computed totals.',
    },
    {
        id: 'N6-dialect-restatement',
        expect: 'grounded',
        kb: DISTRIBUTOR_KB,
        question: 'وين محلكم وشن أوقات الدوام؟',
        reply: 'حنا في سوق الثلاثاء بالمدينة، ونفتحو كل يوم من التسعة الصبح للخمسة العشية.',
        note: 'Same facts, local dialect, spelled-out numerals. Dialect mirroring is deliberate product behaviour (prompt v40/v44) and must never read as ungrounded.',
    },
    {
        id: 'N7-clarifying-question',
        expect: 'grounded',
        kb: DISTRIBUTOR_KB,
        question: 'وش المقاس المناسب؟',
        reply: 'يرجى إخبارنا بعمر الطفل أو وزنه حتى نساعدك في اختيار المقاس المناسب.',
        note: 'Asks instead of guessing — the behaviour the prompt asks for. Contains no claim at all.',
    },
    {
        id: 'N8-denial-of-ungrounded-detail',
        expect: 'grounded',
        kb: DISTRIBUTOR_KB,
        question: 'كم سعر القطعة الوحدة؟',
        reply: 'الأسعار عندنا بالعلبة مش بالقطعة — رقم 5 العلبة 22 قطعة بسعر 45 دينار.',
        note: 'Declines the ungrounded unit price and answers with the grounded pack price. Exactly what e5313a4c wants replies to do.',
    },
    {
        id: 'N9-greeting',
        expect: 'grounded',
        kb: DISTRIBUTOR_KB,
        question: 'السلام عليكم',
        reply: 'وعليكم السلام ورحمة الله، أهلاً بك 🌸 كيف نقدر نساعدك؟',
        note: 'No claim. If greetings flag, the gate that decides WHICH replies get verified is wrong, not the prompt.',
    },
    {
        id: 'N10-swim-diaper-price',
        expect: 'grounded',
        kb: DISTRIBUTOR_KB,
        question: 'عندكم حفاضات سباحة؟',
        reply: 'إيه متوفرة، حفاضات رواء للسباحة بمقاسين S و M بسعر 54 دينار.',
        note: 'A fact buried deep in a ~240-line KB. A verifier that skims the head of the document and flags the tail is unusable on real merchant KBs.',
    },
];

// ---------------------------------------------------------------------------
// Prod export SQL
// ---------------------------------------------------------------------------

/** Replies sampled PER PAGE. Stratified, not proportional: Nourva alone is 67%
 *  of the fleet's AI replies, and a proportional sample would measure one KB.
 *  The report reconstructs the traffic-weighted rate from per-page volumes, so
 *  both numbers are available and neither is implied by the other. */
const PER_PAGE = parseInt(process.env.PER_PAGE || '40', 10);

/**
 * Every KB version as a HALF-OPEN INTERVAL [ingested_at, next ingested_at), so
 * "which KB did this reply see" is a range join, not a per-row lookup.
 *
 * The obvious phrasing — a correlated `SELECT … ORDER BY ingested_at DESC LIMIT 1`
 * per message — has no index to use inside the CTE and degenerates into 30k
 * nested scans over 1,027 version rows; it ran past two minutes on prod and was
 * abandoned. The interval form joins once and lets the planner hash it.
 */
const KB_INTERVALS_CTE = `kb_ver AS (
    -- source_tier 5 = auto-extracted suggestions awaiting merchant review;
    -- retrieval excludes them, so a reconstruction must too.
    SELECT page_id, kb_version, ingested_at,
           lead(ingested_at) OVER (PARTITION BY page_id ORDER BY ingested_at, kb_version) AS next_ingested_at
    FROM (
        SELECT page_id, kb_version, max(created_at) AS ingested_at
        FROM kb_chunks
        WHERE source_tier <> 5
        GROUP BY page_id, kb_version
    ) v
)`;

/** Joins a message row `m` to the KB version that was live when it was answered. */
const KB_INTERVAL_JOIN = `JOIN kb_ver k
        ON k.page_id = m.page_id
       AND m.created_at >= k.ingested_at
       AND (k.next_ingested_at IS NULL OR m.created_at < k.next_ingested_at)`;

/** What the sample can and cannot reach. Run it before the export: a reply
 *  answered BEFORE its page's first KB ingestion has no KB to score against and
 *  is dropped — that count has to be stated, not silently lost. */
function coverageSql(): string {
    return `-- Grounding audit — sample coverage (READ-ONLY).
-- Run:  ./scripts/prod-db-query.sh --file this.sql
WITH ${KB_INTERVALS_CTE},
base AS (
    SELECT m.id, m.page_id, m.created_at, p.kb_active_version
    FROM messages m
    JOIN pages p ON p.id = m.page_id
    JOIN users u ON u.id = p.user_id
    WHERE m.reply_method = 'ai' AND m.direction = 'incoming'
      AND m.reply_text IS NOT NULL AND length(m.reply_text) > 0
      AND m.created_at > now() - interval '30 days'
      AND p.facebook_page_id NOT LIKE 'demo_page_%'
      AND p.name NOT IN (${sqlList(EXCLUDED_PAGE_NAMES)})${merchantFilter()}
),
resolved AS (
    SELECT m.id, m.page_id, m.kb_active_version, k.kb_version AS kb_version_at_reply
    FROM base m
    LEFT ${KB_INTERVAL_JOIN}
)
SELECT count(*) AS ai_replies_30d,
       count(*) FILTER (WHERE kb_version_at_reply IS NOT NULL) AS scoreable,
       count(*) FILTER (WHERE kb_version_at_reply = kb_active_version) AS kb_exact,
       count(*) FILTER (WHERE kb_version_at_reply IS NOT NULL AND kb_version_at_reply <> kb_active_version) AS kb_reconstructed,
       count(*) FILTER (WHERE kb_version_at_reply IS NULL) AS replied_before_any_kb_version,
       count(DISTINCT page_id) AS pages
FROM resolved;
`;
}

/** Pages that are ours, not a merchant's: the seeded demo fixtures, the WhatsApp
 *  pilot, and the internal «موظف 24/7» test page. Their traffic is us talking to
 *  ourselves, so including it would move the fleet numbers without describing any
 *  customer. Excluded at the SQL level so a sample can never quietly contain them. */
const EXCLUDED_PAGE_NAMES = ['WhatsApp Pilot (Test)', 'موظف 24/7'];

/**
 * The accounts the measurement is about. Scoped deliberately rather than swept
 * fleet-wide: these are the paying merchants plus the owner's own canary, i.e.
 * the traffic where a fabrication costs a real customer. A sample dominated by
 * low-volume or abandoned pages would move the headline rate without describing
 * anyone who is paying.
 *
 * Override with MERCHANT_EMAILS="a@x.com,b@y.com"; set MERCHANT_EMAILS=* to
 * sweep every page instead (the fleet-wide shape, with EXCLUDED_PAGE_NAMES and
 * the demo fixtures still filtered out).
 */
const MERCHANT_EMAILS = (process.env.MERCHANT_EMAILS
    || 'feras10mgb@gmail.com,nourvacare@gmail.com,aliahdab@gmail.com,waleedraffas@gmail.com')
    .split(',').map(e => e.trim()).filter(Boolean);

/** SQL literal list, single-quote-escaped. */
function sqlList(values: string[]): string {
    return values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
}

/** Restricts a query to MERCHANT_EMAILS via the page's owning user. Empty when
 *  MERCHANT_EMAILS=*, so the same SQL serves both the scoped and fleet runs. */
function merchantFilter(): string {
    if (MERCHANT_EMAILS.length === 1 && MERCHANT_EMAILS[0] === '*') return '';
    return `\n      AND u.email IN (${sqlList(MERCHANT_EMAILS)})`;
}

function exportSql(): string {
    return `-- Grounding audit — prod sample export (READ-ONLY).
-- Run:  PSQL_ARGS=-At ./scripts/prod-db-query.sh --file this.sql > sample.json
--
-- Each reply is scored against the KB THAT REPLY SAW, resolved as the greatest
-- kb_version whose chunks were ingested at or before the reply. Scoring a reply
-- against a KB it never had is the timeline error that produced (and retracted)
-- the "buried facts" diagnosis on 2026-07-27, so the join makes it impossible
-- rather than something to remember.
--
-- Two sources, labeled per row in kb_source, because they are not equally
-- trustworthy and a silent mix would be unreadable:
--   exact         — the reply ran on the page's CURRENT kb_active_version, so
--                   pages.knowledge_base is byte-for-byte what the model saw.
--   reconstructed — an older version, rebuilt by concatenating that version's
--                   kb_chunks. Measured at 90-104% of the live KB's character
--                   count across the fleet (chunk overlap explains >100%), so
--                   the FACTS survive but the exact prompt text does not. A
--                   reconstruction that is short by a few percent can make a
--                   grounded reply look unsupported, which is why the report
--                   splits the firing rate by this column.
-- Without the reconstruction there is barely a sample at all: of 30,521 AI
-- replies in the last 30 days only 1,170 ran on their page's current version,
-- and BAMBO LIBYA — the page with the documented fabrication — had ZERO.

WITH ${KB_INTERVALS_CTE},
elig AS (
    SELECT
        m.id, m.page_id, m.conversation_id, m.message, m.reply_text,
        m.ai_intent, m.flag_reason, m.needs_attention, m.created_at,
        k.kb_version AS kb_version_at_reply
    FROM messages m
    JOIN pages p ON p.id = m.page_id
    JOIN users u ON u.id = p.user_id
    ${KB_INTERVAL_JOIN}
    WHERE m.reply_method = 'ai'
      AND m.direction = 'incoming'
      AND m.reply_text IS NOT NULL
      AND length(m.reply_text) > 0
      AND m.created_at > now() - interval '30 days'
      AND p.facebook_page_id NOT LIKE 'demo_page_%'
      AND p.name NOT IN (${sqlList(EXCLUDED_PAGE_NAMES)})${merchantFilter()}
),
-- Per-page volume travels with every row so the report can rebuild the
-- traffic-weighted rate from a stratified sample.
page_totals AS (
    SELECT page_id, count(*) AS page_replies_30d FROM elig GROUP BY page_id
),
picked AS (
    SELECT * FROM (
        SELECT e.*, row_number() OVER (PARTITION BY e.page_id ORDER BY random()) AS rn
        FROM elig e
    ) r WHERE r.rn <= ${PER_PAGE}
),
sample AS (
    SELECT
        r.id,
        p.name AS page_name,
        t.page_replies_30d,
        CASE WHEN r.kb_version_at_reply = p.kb_active_version THEN 'exact' ELSE 'reconstructed' END AS kb_source,
        CASE WHEN r.kb_version_at_reply = p.kb_active_version THEN p.knowledge_base ELSE kt.kb_text END AS kb,
        r.message AS question,
        r.reply_text AS reply,
        r.ai_intent AS intent,
        r.flag_reason,
        r.needs_attention,
        r.created_at,
        hist.turns AS history
    FROM picked r
    JOIN pages p ON p.id = r.page_id
    JOIN page_totals t ON t.page_id = r.page_id
    LEFT JOIN LATERAL (
        SELECT string_agg(c.content_original, E'\\n\\n' ORDER BY c.created_at, c.id) AS kb_text
        FROM kb_chunks c
        WHERE c.page_id = r.page_id
          AND c.kb_version = r.kb_version_at_reply
          AND c.source_tier <> 5
    ) kt ON true
    LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('q', h.message, 'a', h.reply_text) ORDER BY h.created_at) AS turns
        FROM (
            SELECT h2.message, h2.reply_text, h2.created_at
            FROM messages h2
            WHERE h2.conversation_id = r.conversation_id
              AND h2.created_at < r.created_at
            ORDER BY h2.created_at DESC
            LIMIT 4
        ) h
    ) hist ON true
)
SELECT coalesce(json_agg(s), '[]'::json)
FROM sample s
WHERE s.kb IS NOT NULL AND length(s.kb) >= 200;
`;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Bounded-concurrency map. Kept local and tiny — the alternative is a
 *  dependency for twelve lines, and every other script here does the same. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            for (;;) {
                const i = next++;
                if (i >= items.length) return;
                out[i] = await fn(items[i], i);
            }
        }),
    );
    return out;
}

function money(usd: number): string {
    return `$${usd.toFixed(4)}`;
}

async function runLabeled(): Promise<void> {
    console.log(`\n🔬 Grounding audit — labeled set (${LABELED_CASES.length} cases, model ${MODEL})\n`);

    const results = await mapPool(LABELED_CASES, CONCURRENCY, async (c) => {
        const v = await verifyGrounding({ kb: c.kb, question: c.question, reply: c.reply, history: c.history });
        return { c, v, correct: v.verdict === c.expect };
    });

    const positives = results.filter(r => r.c.expect === 'unsupported');
    const negatives = results.filter(r => r.c.expect === 'grounded');
    const caught = positives.filter(r => r.correct).length;
    const falsePositives = negatives.filter(r => !r.correct);
    const missed = positives.filter(r => !r.correct);

    for (const r of results) {
        if (!r.correct || VERBOSE) {
            const mark = r.correct ? '✅' : (r.c.expect === 'unsupported' ? '❌ MISS' : '🚨 FALSE POSITIVE');
            console.log(`${mark}  ${r.c.id}  →  ${r.v.verdict}`);
            for (const claim of r.v.unsupported_claims) {
                console.log(`      • [${claim.kind}] "${claim.text}" — ${claim.why}`);
            }
            if (!r.correct) console.log(`      ↳ ${r.c.note}`);
            console.log('');
        }
    }

    const precision = caught + falsePositives.length > 0
        ? caught / (caught + falsePositives.length)
        : 1;
    const recall = positives.length > 0 ? caught / positives.length : 1;
    const cost = results.reduce((s, r) => s + r.v.costUsd, 0);
    const tokensIn = results.reduce((s, r) => s + r.v.tokensIn, 0);
    const cachedIn = results.reduce((s, r) => s + r.v.cachedIn, 0);

    console.log('─'.repeat(72));
    console.log(`Recall     ${caught}/${positives.length} fabrications caught      (${(recall * 100).toFixed(0)}%)`);
    console.log(`Precision  ${caught}/${caught + falsePositives.length} flags were real defects  (${(precision * 100).toFixed(0)}%)`);
    console.log(`False positives on correct replies: ${falsePositives.length}/${negatives.length}${falsePositives.length ? ` — ${falsePositives.map(r => r.c.id).join(', ')}` : ''}`);
    console.log(`Missed fabrications: ${missed.length}${missed.length ? ` — ${missed.map(r => r.c.id).join(', ')}` : ''}`);
    console.log(`Cost ${money(cost)} for ${results.length} calls (${money(cost / results.length)}/reply · ${tokensIn} in, ${cachedIn} cached)`);
    console.log('─'.repeat(72));
    console.log(
        '\nRead this as a GATE, not a score: N1 (honest denial) and N2 (denial + grounded\n'
        + 'alternative) flagging at all disqualifies the candidate — that is the exact\n'
        + 'failure the previous guard was rejected for. Recall matters second.\n'
        + 'Then run --dataset on real traffic: the labeled set cannot tell you how often\n'
        + 'this fires on the other 99% of replies.\n',
    );
}

interface DatasetRow {
    id: string;
    page_name: string | null;
    /** Replies this page sent in the window — the weight that turns a stratified
     *  sample back into a traffic-weighted estimate. */
    page_replies_30d: number;
    /** 'exact' = the page's current KB text; 'reconstructed' = rebuilt from that
     *  version's kb_chunks. Reported separately: a short reconstruction can make
     *  a grounded reply look unsupported, and that must not hide inside one rate. */
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

async function runDataset(path: string): Promise<void> {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as DatasetRow[];
    const rows = raw.filter(r => r.kb && r.reply && r.question);
    if (rows.length !== raw.length) {
        console.log(`ℹ️  ${raw.length - rows.length} row(s) skipped: missing kb/reply/question.`);
    }
    console.log(`\n🔬 Grounding audit — prod sample (${rows.length} replies, model ${MODEL})\n`);

    let done = 0;
    const results = await mapPool(rows, CONCURRENCY, async (row) => {
        const v = await verifyGrounding({
            kb: row.kb,
            question: row.question,
            reply: row.reply,
            history: row.history || undefined,
        });
        done++;
        if (done % 25 === 0) console.log(`   … ${done}/${rows.length}`);
        return { row, v };
    });

    const fired = results.filter(r => r.v.verdict === 'unsupported');
    // The number that decides whether this is worth shipping: replies the fleet
    // currently sends with NO flag at all and no Needs Attention entry. Anything
    // already flagged is visible to the merchant today — the verifier adds
    // nothing there.
    const newlyCaught = fired.filter(r => !r.row.flag_reason && !r.row.needs_attention);
    const byKind = new Map<string, number>();
    for (const r of fired) {
        for (const c of r.v.unsupported_claims) byKind.set(c.kind, (byKind.get(c.kind) || 0) + 1);
    }
    // Per-page rates, and the traffic-weighted estimate they imply. The sample is
    // stratified (equal rows per page), so its headline rate weights a page with
    // 12 replies the same as one with 20,384 — useful for finding which merchant
    // has a problem, wrong for "how often does this fire on the fleet".
    const perPage = new Map<string, { fired: number; scored: number; volume: number }>();
    for (const r of results) {
        const k = r.row.page_name || '(unnamed)';
        const e = perPage.get(k) || { fired: 0, scored: 0, volume: r.row.page_replies_30d || 0 };
        e.scored++;
        if (r.v.verdict === 'unsupported') e.fired++;
        perPage.set(k, e);
    }
    const totalVolume = [...perPage.values()].reduce((s, e) => s + e.volume, 0);
    const weightedRate = totalVolume > 0
        ? [...perPage.values()].reduce((s, e) => s + (e.fired / e.scored) * e.volume, 0) / totalVolume
        : 0;

    const bySource = (src: DatasetRow['kb_source']) => {
        const rows = results.filter(r => r.row.kb_source === src);
        const hit = rows.filter(r => r.v.verdict === 'unsupported').length;
        return rows.length ? `${hit}/${rows.length} (${((hit / rows.length) * 100).toFixed(1)}%)` : '—';
    };

    const cost = results.reduce((s, r) => s + r.v.costUsd, 0);
    const cachedIn = results.reduce((s, r) => s + r.v.cachedIn, 0);
    const tokensIn = results.reduce((s, r) => s + r.v.tokensIn, 0);

    const reviewPath = join(tmpdir(), `grounding-audit-review-${rows.length}.json`);
    writeFileSync(reviewPath, JSON.stringify(
        fired.map(r => ({
            id: r.row.id,
            page: r.row.page_name,
            created_at: r.row.created_at,
            intent: r.row.intent,
            existing_flag: r.row.flag_reason,
            kb_source: r.row.kb_source,
            question: r.row.question,
            reply: r.row.reply,
            unsupported_claims: r.v.unsupported_claims,
        })),
        null, 2,
    ));

    console.log('\n' + '─'.repeat(72));
    console.log(`Fired on          ${fired.length}/${rows.length} sampled replies (${((fired.length / rows.length) * 100).toFixed(1)}%, stratified)`);
    console.log(`Traffic-weighted  ${(weightedRate * 100).toFixed(1)}% — what the fleet would actually see`);
    console.log(`Already visible   ${fired.length - newlyCaught.length} had a flag_reason or needs_attention`);
    console.log(`NEW               ${newlyCaught.length} replies the merchant sees nothing about today`);
    console.log(`KB exact          ${bySource('exact')}`);
    console.log(`KB reconstructed  ${bySource('reconstructed')}  ← a much higher rate here means the reconstruction, not the reply`);
    console.log(`By claim kind     ${[...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join('  ') || '—'}`);
    console.log('Per page          fired/scored  (30d volume)');
    for (const [name, e] of [...perPage.entries()].sort((a, b) => b[1].volume - a[1].volume)) {
        console.log(`  ${name.padEnd(46).slice(0, 46)} ${String(e.fired).padStart(3)}/${String(e.scored).padEnd(3)}  (${e.volume})`);
    }
    console.log(`Cost              ${money(cost)} total · ${money(cost / rows.length)}/reply · ${tokensIn} in (${cachedIn} cached)`);
    console.log('─'.repeat(72));
    console.log(`\n📄 Every firing written to:\n   ${reviewPath}\n`);
    console.log(
        'NEXT: read that file and label each firing real / false positive. That hand\n'
        + 'count IS the precision number — nothing else in this pipeline can produce it,\n'
        + 'and shipping without it repeats the mistake that got the last guard rejected.\n'
        + 'A firing rate above ~5% on ordinary traffic means the verifier is too eager,\n'
        + 'not that the fleet hallucinates that much.\n',
    );
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.includes('--print-sql')) {
        console.log(exportSql());
        return;
    }

    if (args.includes('--print-coverage-sql')) {
        console.log(coverageSql());
        return;
    }

    if (!process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY required');
        process.exit(1);
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const dsIndex = args.indexOf('--dataset');
    if (dsIndex !== -1) {
        const path = args[dsIndex + 1];
        if (!path) {
            console.error('--dataset needs a path to the exported JSON sample');
            process.exit(1);
        }
        await runDataset(path);
        return;
    }

    await runLabeled();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
