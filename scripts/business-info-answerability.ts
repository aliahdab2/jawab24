/**
 * Business Info answerability — the reply-quality instrument for the /business
 * clarity work (D-113; plan: .planning/BUSINESS_SURFACE_PLAN.md §G2 names the
 * gap this fills — the milestone's adopted output instrument, the shadow
 * grounding verifier, is blind to FALSE DENIALS by design; this script reads
 * the "miss" side from a signal that already exists).
 *
 * READ-ONLY. Every query goes through `scripts/prod-db-query.sh --file`, whose
 * keyword blocklist refuses anything but SELECT/WITH. The script never opens a
 * DB connection of its own. Snapshots are written LOCALLY, never to prod.
 *
 * Modes (combine freely):
 *   npx tsx scripts/business-info-answerability.ts --census
 *       Fleet read: how many connected pages hold information where — free
 *       text only / catalog / lists / store / ≥3 homes — plus the finding-5
 *       measurement (D-113): how many live KBs carry the `💰` stored header
 *       and whether what sits under it is a price list or prose.
 *   npx tsx scripts/business-info-answerability.ts --baseline [--from YYYY-MM-DD --to YYYY-MM-DD]
 *       Per page-week outcome + input metrics for the window (default: the 30
 *       days ending yesterday). DMs are the primary channel; comments are
 *       reported separately and never pooled (the D-111 content-free gate
 *       changes which comments get replies at all).
 *   npx tsx scripts/business-info-answerability.ts --snapshot <dir>
 *       Dump every page's knowledge_base / business_profile / catalog rows /
 *       fact collections to <dir>/pages-<date>.json. `pages.knowledge_base` is
 *       overwritten in place — without this file the "before" state is gone.
 *   --exclude <pageId,pageId>   Pages we hand-migrate ourselves (بورسعيد etc.):
 *                               their KB changes are ours, not the page's effect.
 *   --markdown                  Print the report as Markdown tables.
 *
 * THE DENOMINATOR (why "generated", not "sent"): `cacheQualityGate.ts` never
 * caches a reply carrying `info_not_in_kb`, and every Business Info edit bumps
 * `pages.kb_active_version` (`pagesService.invalidatePageCaches`), purging that
 * page's reply cache. So a page that edits serves MORE generated replies in the
 * window after, and a flag-per-SENT rate rises for reasons unrelated to quality.
 * `ai_usage_log(cached)` is the only place cache hits are recorded, so the
 * denominator is "replies the model actually generated" at page-week grain —
 * a window-level join, not a row-level one; say so when quoting it.
 *
 * REPLY IDENTITY: the row that carries `flag_reason` is the INCOMING row
 * (`replied = true AND reply_method = 'ai' AND replied_at IS NOT NULL`); the
 * `direction = 'outgoing'` echo rows in `messages` are never counted. Verify
 * this at the read path on one known page before quoting a number.
 *
 * FLAG MATCHING mirrors `hasAnyFlag` (packages/shared/src/utils/flag-reason.ts):
 * exact membership in the comma-joined string, never a substring match.
 *
 * `flag_meta` is JSONB written by Drizzle as a STRING — `flag_meta ? 'k'` returns
 * nothing; `(flag_meta #>> '{}')::jsonb ? 'k'` is the working form.
 *
 * Everything computed from a page's stored content uses the SHARED predicates
 * production uses (`isBusinessInfoProvided`, `isFieldAuthoritative`, `isRowLive`,
 * `detectCatalogLikePatterns`) — never a re-implementation (Rule 19.3).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PROMPT_VERSION, unwrapBusinessProfile, businessPhoneList } from '../packages/shared/src/index';
import type { BusinessProfile, StoredBusinessProfile } from '../packages/shared/src/index';
import { TRACKED_FIELDS } from '../packages/shared/src/businessProfileMerge';
import { isFieldAuthoritative } from '../packages/shared/src/businessInfoPrompt';
import { isBusinessInfoProvided } from '../packages/shared/src/activation';
import { isRowLive } from '../packages/shared/src/factSchedule';
import { detectCatalogLikePatterns } from '../packages/shared/src/kbContentClassifier';
import { EMOJI_TO_SECTION, SECTION_LABELS } from '../frontend/src/components/knowledge-base/types';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
    census: boolean;
    baseline: boolean;
    snapshot: string | null;
    from: string;
    to: string;
    exclude: Set<string>;
    markdown: boolean;
}

function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Args {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const thirtyDaysBack = new Date(yesterday);
    thirtyDaysBack.setUTCDate(thirtyDaysBack.getUTCDate() - 29);
    const args: Args = {
        census: false,
        baseline: false,
        snapshot: null,
        from: isoDate(thirtyDaysBack),
        to: isoDate(yesterday),
        exclude: new Set(),
        markdown: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            const v = argv[++i];
            if (!v) throw new Error(`${a} needs a value`);
            return v;
        };
        if (a === '--census') args.census = true;
        else if (a === '--baseline') args.baseline = true;
        else if (a === '--snapshot') args.snapshot = next();
        else if (a === '--from') args.from = next();
        else if (a === '--to') args.to = next();
        else if (a === '--exclude') next().split(',').map((s) => s.trim()).filter(Boolean).forEach((id) => args.exclude.add(id));
        else if (a === '--markdown') args.markdown = true;
        else if (a === '--help' || a === '-h') {
            console.log('usage: npx tsx scripts/business-info-answerability.ts [--census] [--baseline] [--snapshot <dir>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--exclude id,id] [--markdown]');
            process.exit(0);
        } else throw new Error(`unknown argument ${a}`);
    }
    if (!args.census && !args.baseline && !args.snapshot) {
        throw new Error('nothing to do — pass --census, --baseline and/or --snapshot <dir>');
    }
    for (const d of [args.from, args.to]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`bad date ${d} (YYYY-MM-DD)`);
    }
    return args;
}

// ---------------------------------------------------------------------------
// Prod access — one path, SELECT-only by construction
// ---------------------------------------------------------------------------

const RUNNER = join(__dirname, 'prod-db-query.sh');

/** Run one SELECT that ends in `json_agg(...)::text` and parse its rows. */
function queryJson<T>(sql: string): T[] {
    if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|vacuum|copy)\b/i.test(sql)) {
        // The runner refuses these too; failing here keeps the message local.
        throw new Error('refusing to run a non-SELECT statement');
    }
    const dir = mkdtempSync(join(tmpdir(), 'bia-'));
    const file = join(dir, 'q.sql');
    try {
        writeFileSync(file, sql);
        const out = execFileSync(RUNNER, ['--file', file], {
            env: { ...process.env, PSQL_ARGS: '-At' },
            encoding: 'utf8',
            maxBuffer: 256 * 1024 * 1024,
        }).trim();
        if (!out || out === 'null') return [];
        return JSON.parse(out) as T[];
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** A date literal for SQL — validated by parseArgs, quoted here once. */
function dateLit(d: string): string {
    return `'${d}'::date`;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface CatalogRow { name: string; price: string | null; currency: string | null; is_available: boolean; starts_at: string | null; ends_at: string | null; created_at: string; updated_at: string }
interface FactRow { name: string; price: string | null; currency: string | null; attributes: unknown; starts_at: string | null; ends_at: string | null; is_available: boolean; created_at: string; updated_at: string }
interface Collection { id: string; label: string; is_complete: boolean | null; created_at: string; rows: FactRow[] | null }
interface PageRow {
    page_id: string;
    name: string;
    workspace_id: string;
    connected: boolean;
    archived: boolean;
    created_at: string;
    store: boolean;
    kb: string | null;
    suggested_kb: string | null;
    kb_updated_at: string | null;
    profile_updated_at: string | null;
    kb_version: number | null;
    kb_active_version: number | null;
    profile: unknown;
    catalog: CatalogRow[] | null;
    collections: Collection[] | null;
}

const PAGES_SQL = `
SELECT json_agg(json_build_object(
  'page_id', p.id,
  'name', p.name,
  'workspace_id', p.workspace_id,
  'connected', (p.access_token IS NOT NULL AND p.access_token <> ''),
  'archived', (p.archived_at IS NOT NULL),
  'created_at', p.created_at,
  'store', (p.ecommerce_store_id IS NOT NULL),
  'kb', p.knowledge_base,
  'suggested_kb', p.suggested_knowledge_base,
  'kb_updated_at', p.kb_updated_at,
  'profile_updated_at', p.business_profile_updated_at,
  'kb_version', p.kb_version,
  'kb_active_version', p.kb_active_version,
  'profile', CASE WHEN p.business_profile IS NULL THEN NULL ELSE (p.business_profile #>> '{}')::jsonb END,
  'catalog', (
    SELECT json_agg(json_build_object(
      'name', c.name, 'price', c.price, 'currency', c.currency, 'is_available', c.is_available,
      'starts_at', c.starts_at, 'ends_at', c.ends_at, 'created_at', c.created_at, 'updated_at', c.updated_at))
    FROM catalog_items c WHERE c.page_id = p.id),
  'collections', (
    SELECT json_agg(json_build_object(
      'id', f.id, 'label', f.label, 'is_complete', f.is_complete, 'created_at', f.created_at,
      'rows', (
        SELECT json_agg(json_build_object(
          'name', r.name, 'price', r.price, 'currency', r.currency, 'attributes', r.attributes,
          'starts_at', r.starts_at, 'ends_at', r.ends_at, 'is_available', r.is_available,
          'created_at', r.created_at, 'updated_at', r.updated_at))
        FROM fact_rows r WHERE r.collection_id = f.id)))
    FROM fact_collections f WHERE f.page_id = p.id)
))::text
FROM pages p;
`;

interface ReplyWeekRow {
    page_id: string;
    channel: 'dm' | 'fb_comment' | 'ig_comment';
    week: string;
    ai_sent: number;
    unanswerable: number;
    low_confidence: number;
    price_deflected: number;
    grounding_flags: number;
}

const FLAGS = (col: string) => `string_to_array(replace(coalesce(${col}, ''), ' ', ''), ',')`;

function replyWeeksSql(from: string, to: string): string {
    const window = (col: string) => `${col} >= ${dateLit(from)} AND ${col} < ${dateLit(to)} + interval '1 day'`;
    const counts = (t: string) => `
      count(*) AS ai_sent,
      count(*) FILTER (WHERE 'info_not_in_kb' = ANY(${FLAGS(`${t}.flag_reason`)})) AS unanswerable,
      count(*) FILTER (WHERE 'low_confidence' = ANY(${FLAGS(`${t}.flag_reason`)})) AS low_confidence,
      count(*) FILTER (WHERE 'price_not_in_kb' = ANY(${FLAGS(`${t}.flag_reason`)})
                         AND ${t}.ai_original_reply IS NOT NULL AND ${t}.ai_original_reply <> ${t}.reply_text) AS price_deflected,
      count(*) FILTER (WHERE ${t}.flag_meta IS NOT NULL
                         AND (${t}.flag_meta #>> '{}')::jsonb ? 'reply_not_grounded_shadow') AS grounding_flags`;
    return `
SELECT json_agg(t)::text FROM (
  SELECT m.page_id, 'dm' AS channel, date_trunc('week', m.replied_at)::date AS week, ${counts('m')}
  FROM messages m
  WHERE m.direction = 'incoming' AND m.replied = true AND m.reply_method = 'ai'
    AND m.replied_at IS NOT NULL AND ${window('m.replied_at')}
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT po.page_id, 'fb_comment' AS channel, date_trunc('week', c.replied_at)::date AS week, ${counts('c')}
  FROM comments c JOIN posts po ON po.id = c.post_id
  WHERE c.replied = true AND c.reply_method = 'ai' AND c.replied_at IS NOT NULL AND ${window('c.replied_at')}
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT im.page_id, 'ig_comment' AS channel, date_trunc('week', ic.replied_at)::date AS week, ${counts('ic')}
  FROM instagram_comments ic JOIN instagram_media im ON im.id = ic.media_id
  WHERE ic.replied = true AND ic.reply_method = 'ai' AND ic.replied_at IS NOT NULL AND ${window('ic.replied_at')}
  GROUP BY 1, 2, 3
) t;
`;
}

interface UsageWeekRow { page_id: string | null; pipeline: string; week: string; generated: number; cached: number; models: string[] }

function usageWeeksSql(from: string, to: string): string {
    return `
SELECT json_agg(t)::text FROM (
  SELECT u.page_id, u.pipeline, date_trunc('week', u.created_at)::date AS week,
    count(*) FILTER (WHERE NOT u.cached) AS generated,
    count(*) FILTER (WHERE u.cached) AS cached,
    array_agg(DISTINCT u.model) AS models
  FROM ai_usage_log u
  WHERE u.pipeline IN ('dm_reply', 'comment_reply')
    AND u.created_at >= ${dateLit(from)} AND u.created_at < ${dateLit(to)} + interval '1 day'
  GROUP BY 1, 2, 3
) t;
`;
}

interface GapWeekRow { page_id: string; week: string; new_gaps: number; resolved_gaps: number }

function gapWeeksSql(from: string, to: string): string {
    return `
SELECT json_agg(t)::text FROM (
  SELECT g.page_id, date_trunc('week', g.first_seen_at)::date AS week,
    count(*) AS new_gaps,
    count(*) FILTER (WHERE g.resolved) AS resolved_gaps
  FROM kb_gaps g
  WHERE g.first_seen_at >= ${dateLit(from)} AND g.first_seen_at < ${dateLit(to)} + interval '1 day'
  GROUP BY 1, 2
) t;
`;
}

// ---------------------------------------------------------------------------
// Page-level derivations — shared predicates only
// ---------------------------------------------------------------------------

/** Is a tracked field actually SET (not just present as an empty shell)? */
function fieldHasValue(merchant: BusinessProfile, field: keyof BusinessProfile): boolean {
    if (field === 'phones') return businessPhoneList(merchant).length > 0;
    const v = merchant[field];
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some((x) => x !== undefined && x !== null && x !== '' && !(Array.isArray(x) && x.length === 0));
    return true;
}

/** Confirmed fields = set in the merchant half AND authoritative per provenance —
 *  the same gate `formatBusinessInfoPrompt` applies before a field reaches the model. */
function confirmedFieldCount(stored: StoredBusinessProfile): number {
    const { merchant = {}, merchantProvenance } = unwrapBusinessProfile(stored);
    return TRACKED_FIELDS.filter((f) => fieldHasValue(merchant, f) && isFieldAuthoritative(merchantProvenance, f)).length;
}

interface PageDerived {
    page_id: string;
    name: string;
    workspace_id: string;
    connected: boolean;
    archived: boolean;
    created_at: string;
    store: boolean;
    kb_chars: number;
    kb_provided: boolean;
    confirmed_fields: number;
    catalog_items: number;
    collections: number;
    complete_collections: number;
    live_rows: number;
    homes: number;
    kb_has_products_header: boolean;
    kb_products_section_shape: 'none' | 'price_list' | 'prose';
    kb_products_section_chars: number;
    kb_updated_at: string | null;
    profile_updated_at: string | null;
    first_info_write: string | null;
    days_to_first_info: number | null;
}

/** The stored `💰 المنتجات والخدمات:` section body, if the KB carries the header.
 *  Reads the same marker table the serializer/parser use, so it can't drift. */
function productsSectionBody(kb: string): string | null {
    const marker = Object.entries(EMOJI_TO_SECTION).find(([, id]) => id === 'products')?.[0];
    if (!marker) return null;
    const lines = kb.split('\n');
    const start = lines.findIndex((l) => l.trimStart().startsWith(marker));
    if (start < 0) return null;
    const markers = Object.keys(EMOJI_TO_SECTION).concat('✦');
    const body: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
        const t = lines[i].trimStart();
        if (markers.some((m) => t.startsWith(m)) && /:/.test(t.slice(0, 60))) break;
        body.push(lines[i]);
    }
    return body.join('\n').trim();
}

function derivePage(p: PageRow, today: string): PageDerived {
    const kb = p.kb ?? '';
    const catalogItems = p.catalog ?? [];
    const collections = p.collections ?? [];
    const liveRows = collections.reduce(
        (n, c) => n + (c.rows ?? []).filter((r) => isRowLive({ startsAt: r.starts_at, endsAt: r.ends_at }, today)).length,
        0,
    );
    const kbProvided = isBusinessInfoProvided(p.kb, p.suggested_kb);
    const homes = [kbProvided, catalogItems.length > 0, liveRows > 0, p.store].filter(Boolean).length;
    const section = kb ? productsSectionBody(kb) : null;
    const shape: PageDerived['kb_products_section_shape'] =
        section === null ? 'none' : detectCatalogLikePatterns(section).hasCatalog ? 'price_list' : 'prose';
    // Earliest EVIDENCE of a merchant write. Not `kb_updated_at` /
    // `business_profile_updated_at` on their own: the Facebook sync writes both
    // at connect time (first run: 30/33 new pages "wrote" on day 0). What counts
    // is a field the merchant confirmed in the editor (`confirmedAt` — the same
    // stamp `isFieldAuthoritative` trusts), a row they created, or a KB that
    // diverged from the sync snapshot (`isBusinessInfoProvided`). ⚠️ an UPPER
    // bound on the true first write: `confirmedAt` and `kb_updated_at` record
    // the LATEST write of that field/text; only row creation is a true first.
    const { merchantProvenance = {} } = unwrapBusinessProfile(p.profile as StoredBusinessProfile);
    const confirmedStamps = Object.values(merchantProvenance)
        .filter((e) => e && e.source === 'editor' && e.confirmedAt)
        .map((e) => String(e!.confirmedAt));
    const firstWrites = [
        ...(kbProvided ? [p.kb_updated_at] : []),
        ...confirmedStamps,
        ...catalogItems.map((c) => c.created_at),
        ...collections.map((c) => c.created_at),
    ].filter((d): d is string => !!d).sort();
    const firstInfo = firstWrites[0] ?? null;
    const daysToFirst = firstInfo
        ? Math.max(0, Math.round((Date.parse(firstInfo) - Date.parse(p.created_at)) / 86_400_000))
        : null;
    return {
        page_id: p.page_id,
        name: p.name,
        workspace_id: p.workspace_id,
        connected: p.connected,
        archived: p.archived,
        created_at: p.created_at,
        store: p.store,
        kb_chars: kb.trim().length,
        kb_provided: kbProvided,
        confirmed_fields: confirmedFieldCount(p.profile as StoredBusinessProfile),
        catalog_items: catalogItems.length,
        collections: collections.length,
        complete_collections: collections.filter((c) => c.is_complete === true).length,
        live_rows: liveRows,
        homes,
        kb_has_products_header: section !== null,
        kb_products_section_shape: shape,
        kb_products_section_chars: section?.length ?? 0,
        kb_updated_at: p.kb_updated_at,
        profile_updated_at: p.profile_updated_at,
        first_info_write: firstInfo,
        days_to_first_info: daysToFirst,
    };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function pct(n: number, d: number): string {
    return d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}% (${n}/${d})`;
}

function median(xs: number[]): number | null {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function census(pages: PageDerived[], md: boolean): void {
    const live = pages.filter((p) => p.connected && !p.archived);
    const rows: Array<[string, number]> = [
        ['pages total', pages.length],
        ['connected (access_token set, not archived)', live.length],
        ['  with nothing (no KB, no catalog, no lists, no store)', live.filter((p) => p.homes === 0).length],
        ['  free text only (KB provided, no catalog/lists/store)', live.filter((p) => p.kb_provided && p.homes === 1).length],
        ['  with catalog items', live.filter((p) => p.catalog_items > 0).length],
        ['  with fact collections', live.filter((p) => p.collections > 0).length],
        ['    …with ≥1 LIVE row', live.filter((p) => p.live_rows > 0).length],
        ['    …with ≥1 collection marked complete', live.filter((p) => p.complete_collections > 0).length],
        ['  store-linked', live.filter((p) => p.store).length],
        ['  ≥3 homes', live.filter((p) => p.homes >= 3).length],
        ['  KB ≥ 2,000 chars', live.filter((p) => p.kb_chars >= 2000).length],
        ['  ≥1 confirmed structured field', live.filter((p) => p.confirmed_fields > 0).length],
        ['  KB carries the stored 💰 header (finding 5)', live.filter((p) => p.kb_has_products_header).length],
        ['    …section is a price list (detectCatalogLikePatterns)', live.filter((p) => p.kb_products_section_shape === 'price_list').length],
        ['    …section is prose', live.filter((p) => p.kb_products_section_shape === 'prose').length],
    ];
    const kbMedian = median(live.filter((p) => p.kb_chars > 0).map((p) => p.kb_chars));
    const sectionMedian = median(live.filter((p) => p.kb_has_products_header).map((p) => p.kb_products_section_chars));
    const confirmedMedian = median(live.map((p) => p.confirmed_fields));
    console.log(md ? '\n## Census\n\n| metric | count |\n|---|---|' : '\nCENSUS');
    for (const [k, v] of rows) console.log(md ? `| ${k.trim()} | ${v} |` : `  ${k.padEnd(62)} ${v}`);
    console.log(md ? `\nMedian KB length (pages with text): ${kbMedian ?? '—'} chars · median 💰-section length: ${sectionMedian ?? '—'} · median confirmed fields: ${confirmedMedian ?? '—'}`
        : `  median KB chars ${kbMedian ?? '—'} · median 💰-section chars ${sectionMedian ?? '—'} · median confirmed fields ${confirmedMedian ?? '—'}`);
    console.log(`\nStored header measured: «${Object.entries(EMOJI_TO_SECTION).find(([, id]) => id === 'products')?.[0]} ${SECTION_LABELS.products.ar}:»`);
}

interface WeekKey { page_id: string; week: string }

function key(k: WeekKey): string {
    return `${k.page_id}|${k.week}`;
}

function baseline(
    pages: PageDerived[],
    replies: ReplyWeekRow[],
    usage: UsageWeekRow[],
    gaps: GapWeekRow[],
    args: Args,
): void {
    const byPage = new Map(pages.map((p) => [p.page_id, p]));
    const usageByKey = new Map<string, { generated: number; cached: number; models: Set<string> }>();
    for (const u of usage) {
        if (!u.page_id) continue;
        const pipeline = u.pipeline === 'dm_reply' ? 'dm' : 'comment';
        const k = `${u.page_id}|${u.week}|${pipeline}`;
        const cur = usageByKey.get(k) ?? { generated: 0, cached: 0, models: new Set<string>() };
        cur.generated += Number(u.generated);
        cur.cached += Number(u.cached);
        u.models.forEach((m) => cur.models.add(m));
        usageByKey.set(k, cur);
    }
    const gapsByKey = new Map(gaps.map((g) => [key(g), g]));
    const models = new Set<string>();
    usage.forEach((u) => u.models.forEach((m) => models.add(m)));

    const header = ['page', 'week', 'channel', 'ai_sent', 'generated', 'cached', 'unanswerable', 'unanswerable_share', 'price_deflected', 'low_conf', 'grounding_flags', 'new_gaps', 'gaps_resolved', 'confirmed_fields', 'live_rows', 'kb_chars', 'excluded'];
    const out: string[][] = [];
    const fleet = { dm: { sent: 0, gen: 0, cached: 0, un: 0, price: 0 }, comment: { sent: 0, gen: 0, cached: 0, un: 0, price: 0 } };
    const sorted = [...replies].sort((a, b) => a.page_id.localeCompare(b.page_id) || a.week.localeCompare(b.week) || a.channel.localeCompare(b.channel));
    for (const r of sorted) {
        const p = byPage.get(r.page_id);
        const pipeline = r.channel === 'dm' ? 'dm' : 'comment';
        const u = usageByKey.get(`${r.page_id}|${r.week}|${pipeline}`) ?? { generated: 0, cached: 0, models: new Set<string>() };
        const g = gapsByKey.get(key(r));
        const excluded = args.exclude.has(r.page_id);
        const sent = Number(r.ai_sent);
        const un = Number(r.unanswerable);
        // Generated is a WINDOW-level count from ai_usage_log; it can exceed the
        // sent count (replies generated then withheld/held) or fall below it (log
        // misses). The share uses generated when present, else sent — and says which.
        const denom = u.generated > 0 ? u.generated : sent;
        const denomNote = u.generated > 0 ? '' : ' (no usage rows; per sent)';
        out.push([
            p?.name ?? r.page_id, r.week, r.channel, String(sent), String(u.generated), String(u.cached),
            String(un), `${pct(un, denom)}${denomNote}`, String(r.price_deflected), String(r.low_confidence), String(r.grounding_flags),
            String(g?.new_gaps ?? 0), String(g?.resolved_gaps ?? 0),
            String(p?.confirmed_fields ?? '—'), String(p?.live_rows ?? '—'), String(p?.kb_chars ?? '—'), excluded ? 'yes' : '',
        ]);
        if (!excluded) {
            const f = fleet[pipeline];
            f.sent += sent; f.gen += u.generated; f.cached += u.cached; f.un += un; f.price += Number(r.price_deflected);
        }
    }

    console.log(args.markdown ? `\n## Baseline ${args.from} → ${args.to}\n` : `\nBASELINE ${args.from} → ${args.to}`);
    console.log(`PROMPT_VERSION at run time: ${PROMPT_VERSION} · models seen in window: ${[...models].sort().join(', ') || '—'} · excluded pages: ${[...args.exclude].join(', ') || 'none'}`);
    console.log('Volume floor for scoring a page-week: ≥30 generated replies on that channel. Rows below it are listed, not scored.');
    if (args.markdown) {
        console.log(`\n| ${header.join(' | ')} |\n|${header.map(() => '---').join('|')}|`);
        for (const row of out) console.log(`| ${row.join(' | ')} |`);
    } else {
        console.log(header.join('\t'));
        for (const row of out) console.log(row.join('\t'));
    }
    for (const ch of ['dm', 'comment'] as const) {
        const f = fleet[ch];
        const denom = f.gen > 0 ? f.gen : f.sent;
        console.log(`\nFLEET ${ch.toUpperCase()} (pooled counts, excluded pages removed): sent ${f.sent} · generated ${f.gen} · cached ${f.cached} (cache-hit share ${pct(f.cached, f.gen + f.cached)}) · unanswerable ${pct(f.un, denom)} · price-deflected ${pct(f.price, denom)}`);
    }
    console.log('\nComments are reported separately from DMs and must never be pooled with them (D-111 changes which comments get replies).');
    console.log('Grounding flags are a RAW count on allow-listed pages only — adjudicate ≥30 per page before quoting any rate.');

    // Comprehension: pages connected inside the window.
    const newPages = pages.filter((p) => p.created_at >= args.from && p.created_at < args.to && !p.archived);
    const wrote = newPages.filter((p) => p.first_info_write !== null);
    const within7 = newPages.filter((p) => p.days_to_first_info !== null && p.days_to_first_info <= 7);
    const twoOfThree = newPages.filter((p) => [p.confirmed_fields > 0, p.live_rows > 0 || p.catalog_items > 0, p.kb_provided].filter(Boolean).length >= 2);
    console.log(`\nCOMPREHENSION (pages created in window: ${newPages.length}): wrote any info ${pct(wrote.length, newPages.length)} · first write within 7 days ${pct(within7.length, newPages.length)} · ≥2 of {confirmed fact, live row/catalog item, KB provided} ${pct(twoOfThree.length, newPages.length)} · median days to first write ${median(newPages.map((p) => p.days_to_first_info).filter((d): d is number => d !== null)) ?? '—'}`);
    console.log('Note: "connected" is approximated by pages.created_at (no page-view tracking exists or is added); "days to first write" is an UPPER bound — editor confirmations and kb_updated_at record the latest write, only row creation is a true first.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const today = isoDate(new Date());

    console.error('reading pages (read-only, via prod-db-query.sh)…');
    const pageRows = queryJson<PageRow>(PAGES_SQL);
    const pages = pageRows.map((p) => derivePage(p, today));

    if (args.snapshot) {
        mkdirSync(args.snapshot, { recursive: true });
        const file = join(args.snapshot, `pages-${today}.json`);
        writeFileSync(file, JSON.stringify({ taken_at: new Date().toISOString(), prompt_version: PROMPT_VERSION, pages: pageRows }, null, 1));
        console.log(`snapshot: ${pageRows.length} pages → ${file}`);
    }
    if (args.census) census(pages, args.markdown);
    if (args.baseline) {
        console.error(`reading replies / usage / gaps for ${args.from} → ${args.to}…`);
        const replies = queryJson<ReplyWeekRow>(replyWeeksSql(args.from, args.to));
        const usage = queryJson<UsageWeekRow>(usageWeeksSql(args.from, args.to));
        const gaps = queryJson<GapWeekRow>(gapWeeksSql(args.from, args.to));
        baseline(pages, replies, usage, gaps, args);
    }
}

main();
