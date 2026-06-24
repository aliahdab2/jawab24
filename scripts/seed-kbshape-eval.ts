#!/usr/bin/env npx tsx
/**
 * Phase A fixture — seed two demo pages with the SAME facts in two KB shapes, so the
 * KB-shape eval cases (Category 51 in playground-eval.ts) can be run BEFORE vs AFTER.
 *
 *   KBShape Before — chat-log shape, ingested normally → tier-4 chunks (reproduces the
 *                    retrieval-miss / false-denial bug: facts buried in conversation noise).
 *   KBShape After  — the same facts as clean STRUCTURED records, one chunk per record,
 *                    source_tier=2 (the fix: tier-boosted, self-contained, retrieves reliably).
 *
 * Both KBs are kept ABOVE 5,000 chars on purpose — under that, resolveKnowledge() skips RAG
 * and full-injects the whole KB, which HIDES the retrieval bug (generator.ts:643). The whole
 * point is to exercise the real RAG path on both pages.
 *
 * Prereqs: DATABASE_URL pointing at your local/dev DB, OPENAI_API_KEY set (embeddings cost a
 * few cents total). Run:  npx tsx scripts/seed-kbshape-eval.ts
 *
 * ⚠️ Untested end-to-end without a live DB + OpenAI key — validate the first run (it logs the
 * KB sizes and chunk counts). After seeding, run the before/after:
 *   ADMIN_TOKEN=… CATEGORY=51 npm run eval                 # AFTER page (committed cases) → expect PASS
 *   then temporarily flip the Cat-51 cases' page to 'kbshape_before' to get the BEFORE baseline.
 */
import { config } from '../backend/src/config'; // MUST be first: its dotenv.config() loads env/backend.env before db reads DATABASE_URL
import { randomUUID } from 'crypto';
import { sql, eq } from 'drizzle-orm';
import { db } from '../backend/src/db';
import { pages, kbChunks } from '../backend/src/db/schema';
import { OpenAIEmbeddingProvider } from '../backend/src/services/kb/embedding';
import { getIngestionService } from '../backend/src/services/pages';

const BEFORE_FB_ID = 'kbshape_before_page';
const AFTER_FB_ID = 'kbshape_after_page';

/**
 * The shared facts. Each record is the single source of truth for one offering.
 * NOTE: the makeup price (40k), the women's-hairdressing course (must exist), the first-aid
 * course (30k / 2 weeks), the address, and the hours are the assertions in Category 51.
 */
interface CourseRecord { name: string; price?: string; duration?: string; schedule?: string; mixed?: string; note?: string; }

const COURSES: CourseRecord[] = [
    { name: 'دورة المكياج', price: '٤٠ ألف ل.س لكامل الجلسات', duration: 'شهر', schedule: 'يومين بالأسبوع، ساعة باليوم', mixed: 'غير مختلطة (نسائية)', note: 'للمبتدئات' },
    { name: 'دورة الحلاقة النسائية', price: 'حسب المستوى — تواصلي معنا للتفاصيل', duration: 'شهر', mixed: 'غير مختلطة (نسائية)', note: 'متوفرة حالياً للسيدات' },
    { name: 'دورة الحلاقة الرجالية للمبتدئين', price: '٥٠ ألف ل.س', duration: 'شهر', schedule: 'السبت ١٠–١٢، أو الأحد والثلاثاء ٥–٧' },
    { name: 'دورة الإسعافات الأولية', price: '٣٠ ألف ل.س', duration: 'أسبوعان', note: 'شهادة حضور' },
    { name: 'دورة تركيب وصيانة الطاقة الشمسية', price: '٥٠٠ ألف ل.س', duration: '١٢ جلسة', note: 'تطبيق عملي' },
    { name: 'دورة الكهرباء المنزلية', price: '٥٠٠ ألف ل.س', duration: '١٥ ساعة تدريبية', note: 'شهادة مصدقة' },
    { name: 'دورة اللغة الإنجليزية للمبتدئين', price: '٢٠٠ ألف ل.س', duration: 'شهرين', schedule: 'ثلاث حصص بالأسبوع' },
    { name: 'دورة ICDL', price: '٣٠٠ ألف ل.س', duration: 'شهر', schedule: 'الاثنين والأربعاء ١٠–١١' },
    { name: 'دورة التجميل والعناية بالبشرة', price: '٣٥ ألف ل.س', duration: 'شهر', mixed: 'غير مختلطة (نسائية)' },
    { name: 'دورة التصوير الفوتوغرافي', price: '٢٥٠ ألف ل.س', duration: 'شهر', note: 'تطبيق عملي بالاستوديو' },
    { name: 'دورة إدارة الأعمال', price: '٤٠٠ ألف ل.س', duration: 'شهرين' },
    { name: 'دورة المحاسبة العملية', price: '٣٥٠ ألف ل.س', duration: 'شهرين', note: 'على برامج محاسبية' },
    { name: 'دورة التسويق الرقمي', price: '٣٠٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة الخط العربي', price: '١٥٠ ألف ل.س', duration: 'شهر' },
];

// Realistic extra courses — padding so BOTH KBs exceed 5,000 chars and RAG actually runs
// (under 5,000 the pipeline full-injects and the retrieval bug cannot reproduce).
const EXTRA: CourseRecord[] = [
    { name: 'دورة الرسم والديكور', price: '٢٠٠ ألف ل.س', duration: 'شهر', schedule: 'الأحد والثلاثاء' },
    { name: 'دورة الخياطة والتفصيل', price: '٢٥٠ ألف ل.س', duration: 'شهرين', mixed: 'غير مختلطة (نسائية)' },
    { name: 'دورة الطبخ والحلويات', price: '١٨٠ ألف ل.س', duration: 'شهر', note: 'تطبيق عملي' },
    { name: 'دورة تصميم الجرافيك', price: '٣٥٠ ألف ل.س', duration: 'شهرين', schedule: 'الاثنين والأربعاء' },
    { name: 'دورة البرمجة للمبتدئين', price: '٤٠٠ ألف ل.س', duration: 'ثلاثة أشهر' },
    { name: 'دورة صيانة الموبايل', price: '٣٠٠ ألف ل.س', duration: 'شهر', note: 'تطبيق عملي' },
    { name: 'دورة صيانة الحاسوب', price: '٣٠٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة التبريد والتكييف', price: '٤٥٠ ألف ل.س', duration: 'شهرين', note: 'تطبيق عملي' },
    { name: 'دورة اللحام', price: '٣٥٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة الدهان والديكور الجبصي', price: '٣٠٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة السكرتارية وإدارة المكاتب', price: '٢٥٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة الموارد البشرية', price: '٣٥٠ ألف ل.س', duration: 'شهرين' },
    { name: 'دورة التصميم الداخلي', price: '٤٠٠ ألف ل.س', duration: 'شهرين' },
    { name: 'دورة المونتاج وتحرير الفيديو', price: '٣٥٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة اللغة التركية', price: '٢٠٠ ألف ل.س', duration: 'شهرين' },
    { name: 'دورة اللغة الفرنسية', price: '٢٠٠ ألف ل.س', duration: 'شهرين' },
    { name: 'دورة اللغة الألمانية', price: '٢٢٠ ألف ل.س', duration: 'شهرين' },
    { name: 'دورة تعليم القيادة النظرية', price: '١٥٠ ألف ل.س', duration: 'أسبوعين' },
    { name: 'دورة الإسعاف المتقدم', price: '٤٠ ألف ل.س', duration: 'ثلاثة أسابيع' },
    { name: 'دورة العناية بالأظافر', price: '٣٠ ألف ل.س', duration: 'أسبوعين', mixed: 'غير مختلطة (نسائية)' },
    { name: 'دورة فن الإتيكيت', price: '١٢٠ ألف ل.س', duration: 'أسبوعين' },
    { name: 'دورة إدارة المشاريع', price: '٤٥٠ ألف ل.س', duration: 'شهرين' },
    { name: 'دورة المحادثة الإنجليزية', price: '٢٥٠ ألف ل.س', duration: 'شهرين', schedule: 'الخميس والسبت' },
    { name: 'دورة الإكسل المتقدم', price: '٢٠٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة المحاسبة الضريبية', price: '٣٠٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة كتابة المحتوى', price: '٢٠٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة إدارة وسائل التواصل', price: '٢٨٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة الإلقاء وفن الخطابة', price: '١٨٠ ألف ل.س', duration: 'أسبوعين' },
    // Cross-wire traps: other courses priced at 100k, so a bloated KB can mis-attribute
    // "100 ألف" onto the makeup course (the real prod wrong-price bug). The structured page
    // must NOT cross-wire — makeup stays at its own price.
    { name: 'دورة التغذية والريجيم', price: '١٠٠ ألف ل.س', duration: 'شهر' },
    { name: 'دورة الإسعاف النفسي الأولي', price: '١٠٠ ألف ل.س', duration: 'أسبوعين' },
];
// Generated filler so both KBs land WELL above 5,000 chars (RAG regime, ~115 records).
// Filler topics are distinct from the probe facts, so the probes' tier-2 chunks must still
// win top-5 against this volume — which is exactly the large-merchant case we're testing.
const FILLER: CourseRecord[] = Array.from({ length: 70 }, (_, i) => ({
    name: `دورة تخصصية رقم ${i + 1}`,
    price: `${120 + i * 4} ألف ل.س`,
    duration: i % 2 ? 'شهر' : 'شهرين',
}));
const ALL_COURSES = [...COURSES, ...EXTRA, ...FILLER];

const ADDRESS = 'برامكة سانا، فوق مكتبة الحافظ، الطابق الأول، مدينة دمشق';
const HOURS = 'كل أيام الأسبوع من الساعة ٩ صباحاً إلى الساعة ٨ مساءً، ما عدا يوم الجمعة';
const POLICIES = 'الدورات لا تشمل شهادات إلا برسوم إضافية. التسجيل في المعهد مباشرة. الأسعار لكامل الجلسات وليست لجلسة واحدة. لمعرفة توفر دورة معينة صباحاً أو مساءً تواصلوا معنا.';

// ---- AFTER: clean structured records, one chunk per record (source_tier=2) ----
function renderStructuredRecords(): { title: string; content: string }[] {
    const records = ALL_COURSES.map(c => {
        const parts = [`${c.name}`];
        if (c.price) parts.push(`التكلفة: ${c.price}`);
        if (c.duration) parts.push(`المدة: ${c.duration}`);
        if (c.schedule) parts.push(`المواعيد: ${c.schedule}`);
        if (c.mixed) parts.push(c.mixed);
        if (c.note) parts.push(c.note);
        return { title: c.name, content: parts.join('؛ ') + '.' };
    });
    records.push({ title: 'العنوان', content: `العنوان: ${ADDRESS}.` });
    records.push({ title: 'أوقات الدوام', content: `أوقات الدوام: ${HOURS}.` });
    records.push({ title: 'ملاحظات', content: POLICIES });
    return records;
}

// ---- BEFORE: chat-log shape — the same facts buried in pasted Q&A fragments ----
function renderChatLog(): string {
    const head = `💰 المنتجات والخدمات:\nالعنوان: ${ADDRESS}.\n\n📝 ملاحظات: ${POLICIES}\n\nأوقات الدوام: ${HOURS}\n\n`;
    const frags = [
        'Q: حابة اعرف عن دورة المكياج وسعرها ٤٠ اديش مدتها ومختلط\nA: دورة الحلاقة النسائية و المكياج غير مختلطة',
        'Q: في دورة اسعافات؟\nA: اي عنا دورة اسعافات اولية',
        'Q: قديش مدة الدورات\nA: اغلب الدورات شهر',
        'Q: عندكم حلاقة رجالية؟\nA: اي دورة الحلاقة الرجالية للمبتدئين ٥٠ الف تبدأ السبت',
        'Q: اسعاف قديش وكم مدتها\nA: ٣٠ الف ومدتها اسبوعين',
        'Q: في انجليزي؟\nA: اي عنا دورة انجليزي للمبتدئين',
        'Q: الطاقة الشمسية بكم\nA: ٥٠٠ الف ١٢ جلسة',
        'Q: عندكم icdl\nA: اي بسعر ٣٠٠ الف',
        'Q: في دورة تصوير\nA: اي ٢٥٠ الف',
        'Q: المحاسبة والادارة\nA: عنا الاثنين',
        'Q: في خط عربي؟\nA: اي ١٥٠ الف',
        'Q: التسويق الرقمي موجود\nA: اي شهر ٣٠٠ الف',
        'Q: العناية بالبشرة\nA: اي نسائية ٣٥ الف',
    ];
    // extra courses as messy one-liner Q&A fragments (same facts, chat-log shape)
    const extraFrags = [...EXTRA, ...FILLER].map(c =>
        `Q: ${c.name} بكم وكم مدتها\nA: ${c.price ?? 'تواصل معنا'}${c.duration ? '، مدتها ' + c.duration : ''}`).join('\n');
    // pad with repeated low-signal greetings (realistic chat-log noise) to clear 5000 chars
    const noise = Array.from({ length: 25 }, (_, i) =>
        `Q: مرحبا\nA: أهلين فيكِ 🌸 كيف فيني ساعدك بخصوص الفريق الدمشقي للتدريب؟ (محادثة ${i + 1})`).join('\n');
    return head + frags.join('\n') + '\n' + extraFrags + '\n' + noise;
}

async function main() {
    if (!config.openai.apiKey) throw new Error('OPENAI_API_KEY is required (embeddings).');

    // Reuse an existing owner so FKs are valid and /admin/pages shows the pages.
    const [owner] = await db.select({ userId: pages.userId, workspaceId: pages.workspaceId })
        .from(pages).where(sql`${pages.userId} IS NOT NULL AND ${pages.workspaceId} IS NOT NULL`).limit(1);
    if (!owner?.userId || !owner?.workspaceId) {
        throw new Error('No existing page with a user+workspace found. Seed demo data first.');
    }
    const { userId, workspaceId } = owner;

    const ingestion = getIngestionService();
    if (!ingestion) throw new Error('Ingestion service unavailable (check OPENAI_API_KEY).');

    // --- idempotency: drop prior fixture pages + their chunks ---
    for (const fbId of [BEFORE_FB_ID, AFTER_FB_ID]) {
        const existing = await db.select({ id: pages.id }).from(pages).where(eq(pages.facebookPageId, fbId));
        for (const p of existing) {
            await db.delete(kbChunks).where(eq(kbChunks.pageId, p.id));
            await db.delete(pages).where(eq(pages.id, p.id));
        }
    }

    // ---------- BEFORE page (chat-log → tier-4 chunks via normal ingestion) ----------
    const chatLog = renderChatLog();
    const [beforePage] = await db.insert(pages).values({
        userId, workspaceId, facebookPageId: BEFORE_FB_ID,
        name: 'KBShape Before — معهد اختبار',
        accessToken: 'demo_access_token', autoReplyEnabled: true,
        knowledgeBase: chatLog,
    }).returning({ id: pages.id });
    await ingestion.ingestKnowledgeBase(beforePage.id, chatLog, 1); // tier-4 default, activates v1
    const beforeChunks = await db.select({ n: sql<number>`count(*)::int` }).from(kbChunks).where(eq(kbChunks.pageId, beforePage.id));
    console.log(`BEFORE: kb=${chatLog.length} chars, chunks=${beforeChunks[0]?.n} (tier-4)`);
    if (chatLog.length < 5000) console.warn('⚠️ BEFORE KB < 5000 chars — RAG will be skipped, bug will NOT reproduce. Add more content.');

    // ---------- AFTER page (structured records → one tier-2 chunk per record) ----------
    const records = renderStructuredRecords();
    const structuredText = records.map(r => r.content).join('\n\n');
    const [afterPage] = await db.insert(pages).values({
        userId, workspaceId, facebookPageId: AFTER_FB_ID,
        name: 'KBShape After — معهد اختبار',
        accessToken: 'demo_access_token', autoReplyEnabled: true,
        knowledgeBase: structuredText, // kept >5000 so RAG runs over the tier-2 chunks
    }).returning({ id: pages.id });

    const emb = new OpenAIEmbeddingProvider(config.openai.apiKey);
    const vectors = await emb.embedBatch(records.map(r => `${r.title}\n${r.content}`));

    const rows = records.map((r, i) => ({ id: randomUUID(), r, vec: vectors[i] }));
    await db.insert(kbChunks).values(rows.map(({ id, r }) => ({
        id, pageId: afterPage.id, type: 'offering', language: 'ar',
        title: r.title, contentOriginal: r.content, contentNormalized: r.content, titleNormalized: r.title,
        tokenCount: Math.ceil(r.content.length / 3), metadata: { recordId: r.title },
        kbVersion: 1, sourceTier: 2, // ← the structured tier that retrieval boosts above narrative
    })));
    // set embeddings (pgvector can't go through Drizzle's typed insert)
    const pairs = sql.join(rows.map(({ id, vec }) => sql`(${id}::uuid, ${`[${vec.join(',')}]`}::vector)`), sql`, `);
    await db.execute(sql`UPDATE kb_chunks SET embedding = v.emb FROM (VALUES ${pairs}) AS v(id, emb) WHERE kb_chunks.id = v.id`);
    await db.update(pages).set({ kbActiveVersion: 1 }).where(eq(pages.id, afterPage.id));
    console.log(`AFTER: kb=${structuredText.length} chars, chunks=${rows.length} (tier-2, one per record)`);
    if (structuredText.length < 5000) console.warn('⚠️ AFTER KB < 5000 chars — RAG skipped; it will full-inject instead of testing tier-2 retrieval. Add more records.');

    console.log('\nDone. Run: ADMIN_TOKEN=… CATEGORY=51 npm run eval  (AFTER → expect PASS; flip cases to kbshape_before for the BEFORE baseline)');
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
