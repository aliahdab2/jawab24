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
 * Scenarios are the two merchants this work came from, reproduced from their
 * real (anonymized) shapes — a contaminated `phones` field, and a routing table
 * living in an 800-char persona.
 *
 * Run:
 *   ADMIN_TOKEN=<jwt> BASE_URL=http://localhost:3220 \
 *   PROBE_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/autoreply_eval_email \
 *   npx tsx scripts/contact-standard-probe.ts
 *
 * Read-only against production by construction: it writes ONLY to the page it
 * is pointed at in a LOCAL database, and restores that page's original profile
 * when it finishes.
 */

import postgres from 'postgres';
import { formatBusinessInfoPrompt } from '../packages/shared/src/businessInfoPrompt';
import type { BusinessProfile } from '../packages/shared/src/index';
import type { MerchantProvenanceMap } from '../packages/shared/src/businessProfileMerge';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3220';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATABASE_URL = process.env.PROBE_DATABASE_URL
    || 'postgresql://postgres:postgres@localhost:5433/autoreply_eval_email';
/** The demo page used as the carrier for each scenario's data. */
const CARRIER_PAGE = process.env.PROBE_PAGE || 'demo_page_electro';

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
    /** What the merchant has TODAY, verbatim in shape. */
    today: { profile: BusinessProfile; provenance?: MerchantProvenanceMap; persona: string };
    /** The same business expressed through the contact standard. */
    standard: { profile: BusinessProfile; provenance?: MerchantProvenanceMap; persona: string };
    questions: string[];
    /** What a good reply must and must not contain, per question index. */
    expect: { must?: string[]; mustNot?: string[] }[];
}

const CONFIRMED: MerchantProvenanceMap = {
    phones: { source: 'editor', confirmedAt: '2026-08-01T00:00:00.000Z' },
    email: { source: 'editor', confirmedAt: '2026-08-01T00:00:00.000Z' },
};

const SCENARIOS: Scenario[] = [
    {
        key: 'contaminated-phones-field',
        merchant: 'Electronics importer — instructions typed INTO the phones field',
        today: {
            // Verbatim shape from the real editor-confirmed profile: two of the
            // three "phone numbers" are Arabic instruction sentences, and the
            // third is the merchant hand-rolling "number + description" inside
            // one string because there was nowhere else to put the role.
            profile: {
                phones: [
                    'اعطيهم ارقام الصالات فقط',
                    'رقم الجملة فقط يطلب مبيعات جملة',
                    '0911000299 الادارة',
                ],
            },
            provenance: CONFIRMED,
            persona: 'معك رشا من شركة تقنيات الشام\nالنبرة واللهجة: ودود، لهجة سورية\n'
                + 'رقم الادارة 0911000299 لا يرسل إلا في حالة طلب رقم الادارة او الشكاوي',
        },
        standard: {
            profile: {
                phones: [
                    { number: '0911000202', description: 'خدمة ما بعد البيع' },
                    { number: '0911000299', description: 'الإدارة — عند الطلب فقط' },
                ],
            },
            provenance: CONFIRMED,
            // The routing rules leave the persona entirely: they are now data.
            persona: 'معك رشا من شركة تقنيات الشام\nالنبرة واللهجة: ودود، لهجة سورية',
        },
        questions: [
            'ممكن ارقام تلفوناتكم؟',
            'بدي رقم الادارة',
            'عندي عطل بالغسالة، بدي صيانة',
        ],
        expect: [
            // The instruction sentences must never be handed to a customer as
            // contact details — that is what happens today.
            { mustNot: ['اعطيهم ارقام الصالات فقط', 'رقم الجملة فقط يطلب'] },
            { must: ['0911000299'] },
            { must: ['0911000202'], mustNot: ['0911000299'] },
        ],
    },
    {
        key: 'routing-table-in-persona',
        merchant: 'Resort — 8-number routing table inside the 800-char persona',
        today: {
            // Nothing structured at all: every number lives in the identity
            // field, at the cap, invisible to every system that reads contact
            // data (including the lead-capture exclusion).
            profile: {},
            persona: 'سارة، لهجة سورية ودودة، لا تقومي بإعطاء أجوبة خارج نطاق المنتجع.\n'
                + 'للحجوزات ومعرفة الأسعار وتثبيت الحجز التواصل 0982414141\n'
                + 'خدمات المسبح من حجوزات خاصة للجاكوزي وغيرها الاتصال على 0995008336\n'
                + 'للشكاوى 0931671111\n'
                + 'الرقم الأرضي الخاص بالمنتجع 0189955\n'
                + 'البريد الإلكتروني الخاص بالمنتجع sales@example-resort.com',
        },
        standard: {
            profile: {
                phones: [
                    { number: '0982414141', description: 'الحجوزات والأسعار' },
                    { number: '0995008336', description: 'خدمات المسبح والجاكوزي' },
                    { number: '0931671111', description: 'الشكاوى' },
                    { number: '0189955', description: 'الهاتف الأرضي' },
                ],
                email: 'sales@example-resort.com',
            },
            provenance: CONFIRMED,
            // Identity and tone only — what the field is actually for.
            persona: 'سارة، لهجة سورية ودودة، لا تقومي بإعطاء أجوبة خارج نطاق المنتجع.',
        },
        questions: [
            'بدي احجز غرفة، مع مين بحكي؟',
            'بدي استفسر عن المسبح',
            'عندي شكوى',
            'شو الإيميل تبعكم؟',
        ],
        expect: [
            { must: ['0982414141'] },
            { must: ['0995008336'] },
            { must: ['0931671111'] },
            { must: ['sales@example-resort.com'] },
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
    for (const s of SCENARIOS) {
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

async function ask(message: string, persona: string): Promise<string> {
    const res = await fetch(`${BASE_URL}/admin/ai/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
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
    if (!res.ok) return `[HTTP ${res.status}] ${await res.text()}`;
    const json = await res.json() as PlaygroundResponse;
    return json.data?.reply ?? '(no reply)';
}

function verdict(reply: string, e: { must?: string[]; mustNot?: string[] }): string {
    const missing = (e.must ?? []).filter((s) => !reply.includes(s));
    const leaked = (e.mustNot ?? []).filter((s) => reply.includes(s));
    if (missing.length === 0 && leaked.length === 0) return '✅';
    const parts: string[] = [];
    if (missing.length) parts.push(`missing ${missing.join(', ')}`);
    if (leaked.length) parts.push(`LEAKED ${leaked.join(', ')}`);
    return `🔴 ${parts.join(' · ')}`;
}

async function measuredHalf(sql: postgres.Sql): Promise<void> {
    console.log('\n═══ PART 2 — the replies a customer would get (measured) ═══\n');

    const [page] = await sql`
        SELECT id, business_profile FROM pages WHERE facebook_page_id = ${CARRIER_PAGE} LIMIT 1
    `;
    if (!page) {
        console.log(`⚠️  carrier page ${CARRIER_PAGE} not found — skipping.`);
        return;
    }
    process.env.PROBE_PAGE_ID = page.id;
    const original = page.business_profile;

    try {
        for (const s of SCENARIOS) {
            console.log(`▸ ${s.merchant}\n`);
            const arms = [
                { name: 'TODAY    ', cfg: s.today },
                { name: 'STANDARD ', cfg: s.standard },
            ];
            const replies: Record<string, string[]> = {};

            for (const arm of arms) {
                // Bump both version counters: the profile is prompt-injected,
                // so a stale page cache would answer from the previous arm.
                await sql`
                    UPDATE pages
                    SET business_profile = ${sql.json({
                        merchant: arm.cfg.profile,
                        merchantProvenance: arm.cfg.provenance ?? {},
                    } as never)},
                        kb_version = kb_version + 1,
                        kb_active_version = kb_active_version + 1
                    WHERE id = ${page.id}
                `;
                replies[arm.name] = [];
                for (const q of s.questions) {
                    replies[arm.name].push(await ask(q, arm.cfg.persona));
                }
            }

            s.questions.forEach((q, i) => {
                console.log(`  «${q}»`);
                for (const arm of arms) {
                    const reply = replies[arm.name][i];
                    console.log(`    ${arm.name} ${verdict(reply, s.expect[i])}  ${reply.replace(/\n/g, ' ⏎ ')}`);
                }
                console.log('');
            });
        }
    } finally {
        // Always put the carrier page back the way it was found.
        await sql`
            UPDATE pages
            SET business_profile = ${sql.json(original as never)},
                kb_version = kb_version + 1,
                kb_active_version = kb_active_version + 1
            WHERE id = ${page.id}
        `;
        console.log('↩︎  carrier page restored to its original profile.');
    }
}

async function main(): Promise<void> {
    console.log('Contact-standard probe');
    console.log(`  backend : ${BASE_URL}`);
    console.log(`  database: ${DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@')}`);

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
