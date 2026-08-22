/**
 * Product-resolver probe (D-092, Phase 0) — measure before proposing.
 *
 * Replays the candidate scoring of `resolveProduct` against the REAL product
 * chunks in production, read-only, for a corpus of the phrasings customers
 * actually type, and sweeps the decision thresholds so they are read off a
 * table instead of guessed.
 *
 *   emit    — normalize + embed the corpus with the production provider settings
 *             (text-embedding-3-small, 512 dims) and write one SELECT that scores
 *             every query against every product chunk of its page. Run it with
 *               PSQL_ARGS=-At ./scripts/prod-db-query.sh --file <out>/probe.sql > <out>/probe.json
 *   analyze — read that JSON, score five ranking variants, sweep T_CAND / GAP,
 *             and write <out>/probe-report.md.
 *
 * Usage:
 *   node --env-file=backend/.env --import tsx scripts/product-resolver-probe.ts emit <outDir>
 *   node --import tsx scripts/product-resolver-probe.ts analyze <outDir>
 *
 * The SQL is SELECT-only and goes through the runner's guard. Page ids and
 * product ids below are the three dev stores' — the whole production population
 * of e-commerce pages on 2026-08-22 (zid 4, shopify 6, salla 6 products).
 */
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { normalizeArabic } from '@jawab24/shared';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 512;

// ---------------------------------------------------------------------------
// Corpus. `expect` is the set of acceptable platformProductIds:
//   one id   → the resolver must pick exactly it
//   several  → the query is genuinely ambiguous; the resolver must NOT pick one
//   empty    → nothing in the catalog matches; the resolver must say not_found
// ---------------------------------------------------------------------------
type Case = { q: string; expect: string[]; cls: string };
type PageCorpus = { page: string; label: string; cases: Case[] };

const ZID = 'd88d7c02-0374-454f-81ee-239263079df6';
const Z = {
    shoes: 'aa38a910-9da8-4103-8e88-501c0e037e7f',
    sony: 'd2fc56d9-25f7-4479-9ad7-11ce24e05c6d',
    shirt: 'c51712c3-4f01-4f91-baf9-fb26d7580a75',
    glasses: 'c5163044-29ee-4afd-a967-7a642e7311f8',
};
const SHOPIFY = 'a5176165-ef93-4bf8-a916-b28dec960cb0';
const S = {
    iphone: 'demo_prod_1', galaxy: 'demo_prod_2', macbook: 'demo_prod_3',
    airpods: 'demo_prod_4', cover: 'demo_prod_5', appletv: 'demo_prod_6',
};
const SALLA = 'd1bffbd7-69e6-4155-be64-48225a39a28a';
const L = {
    abayaBlack: 'demo_salla_prod_1', abayaEmb: 'demo_salla_prod_2', thobe: 'demo_salla_prod_3',
    bisht: 'demo_salla_prod_4', oud: 'demo_salla_prod_5', kids: 'demo_salla_prod_6',
};

const CORPUS: PageCorpus[] = [
    { page: ZID, label: 'zid (4 products, Latin + Arabic titles, no descriptions)', cases: [
        { q: 'Sony A7S III', expect: [Z.sony], cls: 'exact' },
        { q: 'نظارة شمسية', expect: [Z.glasses], cls: 'exact' },
        { q: 'قميص قطني رجالي', expect: [Z.shirt], cls: 'exact' },
        { q: 'Running Shoes', expect: [Z.shoes], cls: 'exact' },
        { q: 'النظارة', expect: [Z.glasses], cls: 'article' },
        { q: 'القميص', expect: [Z.shirt], cls: 'article' },
        { q: 'النظارة الشمسية', expect: [Z.glasses], cls: 'article' },
        { q: 'بكم القميص القطني', expect: [Z.shirt], cls: 'article' },
        { q: 'نظارات', expect: [Z.glasses], cls: 'morphology' },
        { q: 'نظاره شمسيه', expect: [Z.glasses], cls: 'morphology' },
        { q: 'قمصان', expect: [Z.shirt], cls: 'morphology' },
        { q: 'سوني', expect: [Z.sony], cls: 'cross-script' },
        { q: 'كاميرا سوني', expect: [Z.sony], cls: 'cross-script' },
        { q: 'كاميرا', expect: [Z.sony], cls: 'cross-script' },
        { q: 'حذاء رياضي', expect: [Z.shoes], cls: 'cross-script' },
        { q: 'الحذاء', expect: [Z.shoes], cls: 'cross-script' },
        { q: 'عندكم حذاء للجري؟', expect: [Z.shoes], cls: 'cross-script' },
        { q: 'shirt', expect: [Z.shirt], cls: 'cross-script' },
        { q: 'sunglasses', expect: [Z.glasses], cls: 'cross-script' },
        { q: 'camera', expect: [Z.sony], cls: 'cross-script' },
        { q: 'ساعة ذكية', expect: [], cls: 'not-found' },
        { q: 'بتشحنوا لحلب', expect: [], cls: 'not-found' },
        { q: 'iphone', expect: [], cls: 'not-found' },
        { q: 'عطر', expect: [], cls: 'not-found' },
    ] },
    { page: SHOPIFY, label: 'shopify demo (6 products, Latin titles, Arabic descriptions)', cases: [
        { q: 'iPhone 15 Pro', expect: [S.iphone], cls: 'exact' },
        { q: 'AirPods Pro', expect: [S.airpods], cls: 'exact' },
        { q: 'Apple TV 4K', expect: [S.appletv], cls: 'exact' },
        { q: 'MacBook Air M3', expect: [S.macbook], cls: 'exact' },
        { q: 'iPhone 15', expect: [S.iphone, S.cover], cls: 'ambiguous' },
        { q: 'ايفون', expect: [S.iphone, S.cover], cls: 'ambiguous' },
        { q: 'جوال', expect: [S.iphone, S.galaxy], cls: 'ambiguous' },
        { q: 'ايفون 15 برو', expect: [S.iphone], cls: 'cross-script' },
        { q: 'كفر ايفون', expect: [S.cover], cls: 'near-dup' },
        { q: 'كفر', expect: [S.cover], cls: 'near-dup' },
        { q: 'سامسونج', expect: [S.galaxy], cls: 'cross-script' },
        { q: 'جالكسي', expect: [S.galaxy], cls: 'cross-script' },
        { q: 'هاتف سامسونج', expect: [S.galaxy], cls: 'cross-script' },
        { q: 'ماك بوك', expect: [S.macbook], cls: 'cross-script' },
        { q: 'لابتوب', expect: [S.macbook], cls: 'category' },
        { q: 'ايربودز', expect: [S.airpods], cls: 'cross-script' },
        { q: 'سماعات', expect: [S.airpods], cls: 'category' },
        { q: 'ابل تي في', expect: [S.appletv], cls: 'cross-script' },
        { q: 'شاحن', expect: [], cls: 'not-found' },
        { q: 'ساعة ابل', expect: [], cls: 'not-found' },
    ] },
    { page: SALLA, label: 'salla demo (6 products, Arabic titles + descriptions)', cases: [
        { q: 'عباية مطرزة فاخرة', expect: [L.abayaEmb], cls: 'exact' },
        { q: 'عطر عود ملكي', expect: [L.oud], cls: 'exact' },
        { q: 'بشت رجالي فاخر', expect: [L.bisht], cls: 'exact' },
        { q: 'عباية', expect: [L.abayaBlack, L.abayaEmb], cls: 'ambiguous' },
        { q: 'العباية', expect: [L.abayaBlack, L.abayaEmb], cls: 'ambiguous' },
        { q: 'عبايات', expect: [L.abayaBlack, L.abayaEmb], cls: 'ambiguous' },
        { q: 'abaya', expect: [L.abayaBlack, L.abayaEmb], cls: 'ambiguous' },
        { q: 'عباية سوداء', expect: [L.abayaBlack], cls: 'near-dup' },
        { q: 'العباية المطرزة', expect: [L.abayaEmb], cls: 'near-dup' },
        { q: 'black abaya', expect: [L.abayaBlack], cls: 'cross-script' },
        { q: 'ثوب قطن', expect: [L.thobe], cls: 'partial' },
        { q: 'الثوب', expect: [L.thobe], cls: 'article' },
        { q: 'thobe', expect: [L.thobe], cls: 'cross-script' },
        { q: 'البشت', expect: [L.bisht], cls: 'article' },
        { q: 'العود', expect: [L.oud], cls: 'article' },
        { q: 'عطر', expect: [L.oud], cls: 'partial' },
        { q: 'oud perfume', expect: [L.oud], cls: 'cross-script' },
        { q: 'طقم عيد للاطفال', expect: [L.kids], cls: 'morphology' },
        { q: 'ملابس اطفال', expect: [L.kids], cls: 'category' },
        { q: 'حذاء', expect: [], cls: 'not-found' },
        { q: 'شماغ', expect: [], cls: 'not-found' },
    ] },
];

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------
async function emit(outDir: string): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY missing — run with --env-file=backend/.env');
    const openai = new OpenAI({ apiKey });

    const flat = CORPUS.flatMap((pc, pi) => pc.cases.map((c, ci) => ({ qid: `p${pi}q${ci}`, page: pc.page, ...c })));
    const normalized = flat.map(c => normalizeArabic(c.q));

    const embeddings: number[][] = [];
    for (let i = 0; i < normalized.length; i += 100) {
        const batch = normalized.slice(i, i + 100);
        const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: batch, dimensions: EMBEDDING_DIMENSIONS });
        for (const d of res.data) embeddings.push(d.embedding);
    }

    const values = flat.map((c, i) => {
        const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
        return `(${lit(c.qid)}, ${lit(c.page)}::uuid, ${lit(normalized[i])}, '[${embeddings[i].join(',')}]'::vector)`;
    }).join(',\n');

    // SELECT-only. Every query is scored against every product chunk of its own
    // page at the page's active version — the exact row set `retrieveProducts`
    // will scan. No language or tier boost: product chunks are all tier 4 and
    // the boost would add a constant.
    const sqlText = `WITH q(qid, page_id, qnorm, vec) AS (VALUES\n${values}\n),
scored AS (
  SELECT q.qid,
         c.metadata->>'platformProductId' AS pid,
         c.title,
         round((1 - (c.embedding <=> q.vec))::numeric, 4) AS vec,
         round(similarity(c.title_normalized, q.qnorm)::numeric, 4) AS sim_t,
         round(similarity(c.content_normalized, q.qnorm)::numeric, 4) AS sim_c,
         round(word_similarity(q.qnorm, c.title_normalized)::numeric, 4) AS ws_t,
         round(word_similarity(q.qnorm, c.content_normalized)::numeric, 4) AS ws_c
  FROM q
  JOIN pages p ON p.id = q.page_id
  JOIN kb_chunks c ON c.page_id = p.id AND c.kb_version = p.kb_active_version
                  AND c.type = 'product' AND c.embedding IS NOT NULL
)
SELECT json_agg(scored) FROM scored;`;

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'probe.sql'), sqlText);
    fs.writeFileSync(path.join(outDir, 'corpus.json'), JSON.stringify(flat.map((c, i) => ({ ...c, qnorm: normalized[i] })), null, 2));
    console.log(`emitted ${flat.length} queries → ${path.join(outDir, 'probe.sql')} (${(sqlText.length / 1024).toFixed(0)} KB)`);
}

// ---------------------------------------------------------------------------
// analyze
// ---------------------------------------------------------------------------
type Row = { qid: string; pid: string; title: string; vec: number; sim_t: number; sim_c: number; ws_t: number; ws_c: number };
type CorpusRow = Case & { qid: string; page: string; qnorm: string };

const VARIANTS: Record<string, (r: Row) => number> = {
    'vec only': r => r.vec,
    'trigram (0.6 sim_t + 0.4 sim_c)': r => 0.6 * r.sim_t + 0.4 * r.sim_c,
    'word_sim title only': r => r.ws_t,
    'hybrid (0.7 vec + 0.3 trigram)  = retrieval.ts minus boosts': r => 0.7 * r.vec + 0.3 * (0.6 * r.sim_t + 0.4 * r.sim_c),
    'hybrid-ws (0.7 vec + 0.3 (0.6 ws_t + 0.4 sim_c))': r => 0.7 * r.vec + 0.3 * (0.6 * r.ws_t + 0.4 * r.sim_c),
};

type Decision = { kind: 'resolved'; pid: string } | { kind: 'ambiguous'; pids: string[] } | { kind: 'not_found' };

function decide(ranked: Array<{ pid: string; score: number }>, tCand: number, gap: number): Decision {
    const above = ranked.filter(r => r.score >= tCand);
    if (above.length === 0) return { kind: 'not_found' };
    if (above.length === 1) return { kind: 'resolved', pid: above[0].pid };
    if (above[0].score - above[1].score >= gap) return { kind: 'resolved', pid: above[0].pid };
    return { kind: 'ambiguous', pids: above.slice(0, 3).map(r => r.pid) };
}

function correct(d: Decision, expect: string[]): boolean {
    if (expect.length === 0) return d.kind === 'not_found';
    if (expect.length === 1) return d.kind === 'resolved' && d.pid === expect[0];
    return d.kind === 'ambiguous' && expect.every(e => d.pids.includes(e));
}

function analyze(outDir: string): void {
    const rows: Row[] = JSON.parse(fs.readFileSync(path.join(outDir, 'probe.json'), 'utf8').trim());
    const corpus: CorpusRow[] = JSON.parse(fs.readFileSync(path.join(outDir, 'corpus.json'), 'utf8'));
    const byQ = new Map<string, Row[]>();
    for (const r of rows) byQ.set(r.qid, [...(byQ.get(r.qid) ?? []), r]);

    const out: string[] = [];
    out.push(`# Product-resolver probe — ${new Date().toISOString().slice(0, 10)}`, '');
    out.push(`${corpus.length} queries over ${new Set(rows.map(r => r.pid)).size} product chunks (3 pages, prod, read-only).`, '');

    // 1. Top-1 accuracy per variant, ignoring thresholds (single-answer cases only).
    out.push('## 1. Top-1 ranking accuracy (single-answer cases; thresholds not applied)', '');
    out.push('| variant | correct / n | by class |', '|---|---|---|');
    for (const [name, score] of Object.entries(VARIANTS)) {
        let ok = 0, n = 0;
        const byCls = new Map<string, [number, number]>();
        for (const c of corpus) {
            if (c.expect.length !== 1) continue;
            n++;
            const ranked = (byQ.get(c.qid) ?? []).map(r => ({ pid: r.pid, score: score(r) })).sort((a, b) => b.score - a.score);
            const hit = ranked[0]?.pid === c.expect[0];
            if (hit) ok++;
            const cur = byCls.get(c.cls) ?? [0, 0];
            byCls.set(c.cls, [cur[0] + (hit ? 1 : 0), cur[1] + 1]);
        }
        const cls = [...byCls.entries()].map(([k, [a, b]]) => `${k} ${a}/${b}`).join(' · ');
        out.push(`| ${name} | **${ok}/${n}** | ${cls} |`);
    }
    out.push('');

    // 2. Threshold sweep per variant: decision accuracy over ALL cases.
    out.push('## 2. Decision accuracy with thresholds (all cases: resolved / ambiguous / not_found must match)', '');
    const tCands = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
    const gaps = [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2];
    const best: Record<string, { t: number; g: number; ok: number }> = {};
    for (const [name, score] of Object.entries(VARIANTS)) {
        out.push(`### ${name}`, '', '| T_CAND \\ GAP | ' + gaps.join(' | ') + ' |', '|---|' + gaps.map(() => '---').join('|') + '|');
        for (const t of tCands) {
            const cells: string[] = [];
            for (const g of gaps) {
                let ok = 0;
                for (const c of corpus) {
                    const ranked = (byQ.get(c.qid) ?? []).map(r => ({ pid: r.pid, score: score(r) })).sort((a, b) => b.score - a.score);
                    if (correct(decide(ranked, t, g), c.expect)) ok++;
                }
                cells.push(String(ok));
                if (!best[name] || ok > best[name].ok) best[name] = { t, g, ok };
            }
            out.push(`| ${t} | ${cells.join(' | ')} |`);
        }
        out.push('', `best: T_CAND=${best[name].t}, GAP=${best[name].g} → **${best[name].ok}/${corpus.length}**`, '');
    }

    // 3. Per-query detail for the best hybrid variant — what each miss looks like.
    const bestName = Object.entries(best).sort((a, b) => b[1].ok - a[1].ok)[0][0];
    const { t, g } = best[bestName];
    out.push(`## 3. Per-query detail — ${bestName} @ T_CAND=${t}, GAP=${g}`, '');
    out.push('| page | class | query | expected | decision | top-3 (pid:score) | ok |', '|---|---|---|---|---|---|---|');
    const score = VARIANTS[bestName];
    const pageLabel = (p: string) => CORPUS.find(pc => pc.page === p)?.label.split(' ')[0] ?? p;
    for (const c of corpus) {
        const ranked = (byQ.get(c.qid) ?? []).map(r => ({ pid: r.pid, title: r.title, score: score(r) })).sort((a, b) => b.score - a.score);
        const d = decide(ranked, t, g);
        const dStr = d.kind === 'resolved' ? `resolved ${short(d.pid)}` : d.kind === 'ambiguous' ? `ambiguous [${d.pids.map(short).join(', ')}]` : 'not_found';
        const top = ranked.slice(0, 3).map(r => `${short(r.pid)}:${r.score.toFixed(3)}`).join(' ');
        out.push(`| ${pageLabel(c.page)} | ${c.cls} | ${c.q} | ${c.expect.length ? c.expect.map(short).join(', ') : '—'} | ${dStr} | ${top} | ${correct(d, c.expect) ? '✅' : '❌'} |`);
    }
    out.push('');

    // 4. Score distributions that the thresholds are read from.
    out.push(`## 4. Distributions — ${bestName}`, '');
    const top1Correct: number[] = [], top1Wrong: number[] = [], top1NotFound: number[] = [], gapSingle: number[] = [], gapAmbig: number[] = [];
    for (const c of corpus) {
        const ranked = (byQ.get(c.qid) ?? []).map(r => ({ pid: r.pid, score: score(r) })).sort((a, b) => b.score - a.score);
        if (!ranked.length) continue;
        const gapv = ranked.length > 1 ? ranked[0].score - ranked[1].score : 1;
        if (c.expect.length === 0) top1NotFound.push(ranked[0].score);
        else if (c.expect.length === 1) { (ranked[0].pid === c.expect[0] ? top1Correct : top1Wrong).push(ranked[0].score); gapSingle.push(gapv); }
        else gapAmbig.push(gapv);
    }
    const stats = (xs: number[]) => xs.length ? `n=${xs.length} min=${Math.min(...xs).toFixed(3)} median=${xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(3)} max=${Math.max(...xs).toFixed(3)}` : 'n=0';
    out.push(`- top-1 score when the top-1 is CORRECT (single-answer): ${stats(top1Correct)}`);
    out.push(`- top-1 score when the top-1 is WRONG (single-answer): ${stats(top1Wrong)}`);
    out.push(`- top-1 score on NOT-FOUND queries (must sit below T_CAND): ${stats(top1NotFound)}`);
    out.push(`- gap top1−top2 on single-answer queries (should exceed GAP): ${stats(gapSingle)}`);
    out.push(`- gap top1−top2 on AMBIGUOUS queries (should fall below GAP): ${stats(gapAmbig)}`);
    out.push('');

    // 5. The plan's actual shape: trigram FIRST (lexical hit = resolved, no
    //    embedding needed), then semantic for the rest. Scored with a cost that
    //    reflects what each outcome does to a customer:
    //      resolved & right ........ +1     ambiguous containing the answer ...  0   (recoverable: model asks)
    //      not_found & right ....... +1     ambiguous on a not-found query ..... -0.5 (lists near misses; not a lie)
    //      resolved & WRONG ........ -3     (wrong price/product, cached 5 min)
    //      not_found & product exists -3    ("we don't sell that" for an in-stock item — the worst outcome)
    out.push('## 5. Two-stage decision (trigram first, then semantic) — cost-weighted sweep', '');
    const cost = (d: Decision, expect: string[]): number => {
        if (expect.length === 0) return d.kind === 'not_found' ? 1 : d.kind === 'ambiguous' ? -0.5 : -3;
        if (expect.length === 1) {
            if (d.kind === 'resolved') return d.pid === expect[0] ? 1 : -3;
            if (d.kind === 'ambiguous') return d.pids.includes(expect[0]) ? 0 : -3;
            return -3;
        }
        if (d.kind === 'ambiguous') return expect.every(e => d.pids.includes(e)) ? 1 : -1;
        return d.kind === 'resolved' ? -3 : -3;
    };
    const tri = (r: Row) => 0.6 * r.sim_t + 0.4 * r.sim_c;
    // Semantic stage: candidates are everything at/above T_VEC; it RESOLVES only
    // when the top candidate also clears T_SOLO and leads by G_VEC — otherwise
    // the candidates are returned as ambiguous. T_SOLO=1 means "the semantic
    // stage never resolves; it only proposes".
    const semantic = (byVec: Array<{ pid: string; score: number }>, tVec: number, gVec: number, tSolo: number): Decision => {
        const above = byVec.filter(r => r.score >= tVec);
        if (above.length === 0) return { kind: 'not_found' };
        const lead = above.length === 1 ? 1 : above[0].score - above[1].score;
        if (above[0].score >= tSolo && lead >= gVec) return { kind: 'resolved', pid: above[0].pid };
        return { kind: 'ambiguous', pids: above.slice(0, 3).map(r => r.pid) };
    };
    const twoStage = (rowsQ: Row[], tTri: number, gTri: number, tVec: number, gVec: number, tSolo: number): Decision => {
        const byTri = rowsQ.map(r => ({ pid: r.pid, score: tri(r) })).sort((a, b) => b.score - a.score);
        if (byTri[0] && byTri[0].score >= tTri && (byTri.length === 1 || byTri[0].score - byTri[1].score >= gTri)) {
            return { kind: 'resolved', pid: byTri[0].pid };
        }
        const byVec = rowsQ.map(r => ({ pid: r.pid, score: r.vec })).sort((a, b) => b.score - a.score);
        return semantic(byVec, tVec, gVec, tSolo);
    };
    const tTris = [0.2, 0.25, 0.3, 0.35, 0.4, 0.5];
    const gTris = [0.05, 0.1, 0.15, 0.2];
    const tVecs = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
    const gVecs = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2];
    const tSolos = [0.35, 0.4, 0.45, 0.5, 0.55, 1];
    type Cell = { tTri: number; gTri: number; tVec: number; gVec: number; tSolo: number; total: number; strict: number; wrongResolved: number; falseNotFound: number; ambiguous: number; semResolvedRight: number };
    const cells: Cell[] = [];
    for (const tTri of tTris) for (const gTri of gTris) for (const tVec of tVecs) for (const gVec of gVecs) for (const tSolo of tSolos) {
        let total = 0, strict = 0, wrongResolved = 0, falseNotFound = 0, ambiguous = 0, semResolvedRight = 0;
        for (const c of corpus) {
            const rowsQ = byQ.get(c.qid) ?? [];
            const d = twoStage(rowsQ, tTri, gTri, tVec, gVec, tSolo);
            total += cost(d, c.expect);
            if (correct(d, c.expect)) strict++;
            if (d.kind === 'resolved' && (c.expect.length !== 1 || d.pid !== c.expect[0])) wrongResolved++;
            if (d.kind === 'not_found' && c.expect.length > 0) falseNotFound++;
            if (d.kind === 'ambiguous') ambiguous++;
            const byTri = rowsQ.map(r => ({ pid: r.pid, score: tri(r) })).sort((a, b) => b.score - a.score);
            const triHit = byTri[0] && byTri[0].score >= tTri && (byTri.length === 1 || byTri[0].score - byTri[1].score >= gTri);
            if (!triHit && d.kind === 'resolved' && c.expect.length === 1 && d.pid === c.expect[0]) semResolvedRight++;
        }
        cells.push({ tTri, gTri, tVec, gVec, tSolo, total, strict, wrongResolved, falseNotFound, ambiguous, semResolvedRight });
    }
    cells.sort((a, b) => b.total - a.total || b.strict - a.strict || a.wrongResolved - b.wrongResolved);
    const cellRow = (c: Cell) => `| ${c.tTri} | ${c.gTri} | ${c.tVec} | ${c.gVec} | ${c.tSolo} | **${c.total}** | ${c.strict}/${corpus.length} | ${c.wrongResolved} | ${c.falseNotFound} | ${c.ambiguous} | ${c.semResolvedRight} |`;
    const header = ['| T_TRI | G_TRI | T_VEC | G_VEC | T_SOLO | cost | strict | wrong resolved | false not_found | ambiguous | semantic resolved right |', '|---|---|---|---|---|---|---|---|---|---|---|'];
    out.push('Top settings by cost (of ' + cells.length + ' combinations):', '', ...header);
    for (const c of cells.slice(0, 10)) out.push(cellRow(c));
    out.push('', 'Best setting per T_VEC (the not_found floor) — what raising the floor buys and costs:', '', ...header);
    for (const tVec of tVecs) { const b = cells.find(c => c.tVec === tVec); if (b) out.push(cellRow(b)); }
    out.push('', 'Best setting per T_SOLO (how much the semantic stage is allowed to decide):', '', ...header);
    for (const tSolo of tSolos) { const b = cells.find(c => c.tSolo === tSolo); if (b) out.push(cellRow(b)); }
    out.push('', 'Safest settings (zero wrong resolved, then fewest false not_found, then cost):', '', ...header);
    const safe = cells.filter(c => c.wrongResolved === 0).sort((a, b) => a.falseNotFound - b.falseNotFound || b.total - a.total);
    for (const c of safe.slice(0, 6)) out.push(cellRow(c));
    out.push('');
    const w = safe[0] ?? cells[0];
    out.push(`### Per-query detail at the SAFEST setting (T_TRI=${w.tTri}, G_TRI=${w.gTri}, T_VEC=${w.tVec}, G_VEC=${w.gVec}, T_SOLO=${w.tSolo})`, '');
    out.push('| page | class | query | expected | stage | decision | tri top-2 | vec top-3 | cost |', '|---|---|---|---|---|---|---|---|---|');
    for (const c of corpus) {
        const rowsQ = byQ.get(c.qid) ?? [];
        const byTri = rowsQ.map(r => ({ pid: r.pid, score: tri(r) })).sort((a, b) => b.score - a.score);
        const byVec = rowsQ.map(r => ({ pid: r.pid, score: r.vec })).sort((a, b) => b.score - a.score);
        const triHit = byTri[0] && byTri[0].score >= w.tTri && (byTri.length === 1 || byTri[0].score - byTri[1].score >= w.gTri);
        const d = twoStage(rowsQ, w.tTri, w.gTri, w.tVec, w.gVec, w.tSolo);
        const dStr = d.kind === 'resolved' ? `resolved ${short(d.pid)}` : d.kind === 'ambiguous' ? `ambiguous [${d.pids.map(short).join(', ')}]` : 'not_found';
        const k = cost(d, c.expect);
        out.push(`| ${pageLabel(c.page)} | ${c.cls} | ${c.q} | ${c.expect.length ? c.expect.map(short).join(', ') : '—'} | ${triHit ? 'trigram' : 'semantic'} | ${dStr} | ${byTri.slice(0, 2).map(r => `${short(r.pid)}:${r.score.toFixed(2)}`).join(' ')} | ${byVec.slice(0, 3).map(r => `${short(r.pid)}:${r.score.toFixed(3)}`).join(' ')} | ${k > 0 ? '✅' : k === 0 ? '🟡' : '❌'} ${k} |`);
    }
    out.push('');

    fs.writeFileSync(path.join(outDir, 'probe-report.md'), out.join('\n'));
    console.log(out.slice(0, 12).join('\n'));
    console.log(`\nfull report → ${path.join(outDir, 'probe-report.md')}`);
}

function short(pid: string): string {
    return pid.startsWith('demo_') ? pid.replace('demo_salla_prod_', 'salla').replace('demo_prod_', 'shop') : pid.slice(0, 6);
}

const [mode, outDir] = process.argv.slice(2);
if (!mode || !outDir) {
    console.error('usage: product-resolver-probe.ts <emit|analyze> <outDir>');
    process.exit(2);
}
(mode === 'emit' ? emit(outDir) : Promise.resolve(analyze(outDir))).catch(err => { console.error(err); process.exit(1); });
