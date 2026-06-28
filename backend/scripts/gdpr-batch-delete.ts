/**
 * GDPR batch data-deletion — process Meta's "Download user identifiers" file.
 *
 * Meta periodically emails a batch of app-scoped / page-scoped user IDs (PSIDs) of
 * end-customers who requested data deletion (Section 3(d)(i) of the Platform Terms).
 * Those IDs are NOT merchant accounts — they live as `sender_id` (DMs) and `from_id`
 * (comments) across the tables below. The real-time /webhook/data-deletion callback
 * only covers merchant Facebook-Login accounts (users.facebook_id), so this batch
 * request needs its own purge. This script is that purge.
 *
 * SAFE BY DEFAULT: dry-run unless you pass --confirm. It NEVER deletes a merchant
 * account — a users.facebook_id match is only reported for manual review (deleting a
 * paying merchant is high-stakes and belongs to a different, deliberate flow).
 *
 * Input file: the CSV/JSON you download from
 *   App Dashboard → Settings → Advanced → "Download user identifiers".
 * Auto-detects JSON (array of strings / array of objects) and CSV/TXT (one ID per
 * line or comma-separated). Extracts the long numeric Meta IDs and ignores headers.
 *
 * Usage:
 *   Dry-run (default — reports matches, deletes nothing):
 *     npx tsx backend/scripts/gdpr-batch-delete.ts <path-to-ids-file>
 *   Execute the deletion:
 *     npx tsx backend/scripts/gdpr-batch-delete.ts <path-to-ids-file> --confirm
 *   Production:
 *     docker exec jawab24-backend-green node backend/dist/scripts/gdpr-batch-delete.js /data/ids.csv --confirm
 *
 * A timestamped JSON compliance report (which IDs matched, per-table counts) is written
 * next to the input file as <input>.gdpr-report-<ISO>.json — keep it as proof of deletion.
 */
import { readFileSync, writeFileSync } from 'fs';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, client } from '../src/db';
import {
    conversations,
    messages,
    conversationPauses,
    leads,
    comments,
    instagramComments,
    posts,
    instagramMedia,
    pages,
    workspaces,
    users,
} from '../src/db/schema';

// Each end-customer table that stores a platform user identifier we must purge.
const TARGETS = [
    { name: 'conversations', table: conversations, col: conversations.senderId },
    { name: 'messages', table: messages, col: messages.senderId },
    { name: 'conversation_pauses', table: conversationPauses, col: conversationPauses.senderId },
    { name: 'leads', table: leads, col: leads.senderId },
    { name: 'comments', table: comments, col: comments.fromId },
    { name: 'instagram_comments', table: instagramComments, col: instagramComments.fromId },
] as const;

// Postgres caps bind parameters (~65535); chunk IN-lists well under that.
const CHUNK = 1000;

function chunked<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/**
 * Parse the downloaded identifier file into a deduped list of Meta IDs.
 * Handles JSON arrays (of strings or of objects with an id-like field) and
 * CSV/TXT. Meta user IDs are long numeric strings, so we keep tokens matching
 * /^\d{5,}$/ — this naturally skips CSV headers and quoting.
 */
function parseIds(raw: string): string[] {
    const ids = new Set<string>();
    const ID_RE = /^\d{5,}$/;

    const trimmed = raw.trim();
    let handledAsJson = false;
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const json = JSON.parse(trimmed);
            const arr: unknown[] = Array.isArray(json)
                ? json
                : Array.isArray((json as Record<string, unknown>).data)
                    ? (json as { data: unknown[] }).data
                    : [];
            for (const item of arr) {
                if (typeof item === 'string' || typeof item === 'number') {
                    const v = String(item).trim();
                    if (ID_RE.test(v)) ids.add(v);
                } else if (item && typeof item === 'object') {
                    const o = item as Record<string, unknown>;
                    const cand = o.id ?? o.user_id ?? o.asid ?? o.psid ?? o.identifier;
                    if (cand != null) {
                        const v = String(cand).trim();
                        if (ID_RE.test(v)) ids.add(v);
                    }
                }
            }
            handledAsJson = true;
        } catch {
            handledAsJson = false;
        }
    }

    if (!handledAsJson) {
        // CSV / TXT: split on newlines + commas, keep numeric-id cells.
        for (const line of raw.split(/\r?\n/)) {
            for (const cell of line.split(',')) {
                const v = cell.trim().replace(/^["']|["']$/g, '');
                if (ID_RE.test(v)) ids.add(v);
            }
        }
    }

    return [...ids];
}

async function countMatches(target: typeof TARGETS[number], ids: string[]): Promise<{ ids: string[]; rows: number }> {
    const matched = new Set<string>();
    let rows = 0;
    for (const batch of chunked(ids, CHUNK)) {
        const found = await db
            .selectDistinct({ id: target.col })
            .from(target.table)
            .where(inArray(target.col, batch));
        for (const r of found) if (r.id != null) matched.add(r.id);

        const [{ c }] = await db
            .select({ c: sql<number>`count(*)::int` })
            .from(target.table)
            .where(inArray(target.col, batch));
        rows += c;
    }
    return { ids: [...matched], rows };
}

interface AffectedPage {
    pageId: string;
    pageName: string | null;
    facebookPageId: string | null;
    merchant: string | null;
    matchedIdCount: number;
    matchedRows: number;
}

/**
 * Resolve which pages/merchants the requested IDs touched. The deletion request from
 * Meta names no page — but our own rows do: DM tables carry page_id directly, and
 * comment tables reach it via the parent post/media. PSIDs are page-scoped, so each
 * customer ID maps to exactly one page.
 */
async function resolveAffectedPages(ids: string[]): Promise<AffectedPage[]> {
    const agg = new Map<string, { rows: number; ids: Set<string> }>();
    const add = (pageId: string | null, senderId: string | null) => {
        if (!pageId) return;
        const e = agg.get(pageId) ?? { rows: 0, ids: new Set<string>() };
        e.rows += 1;
        if (senderId) e.ids.add(senderId);
        agg.set(pageId, e);
    };

    // DM tables — page_id is a direct column.
    const dmSources = [
        { from: conversations, idCol: conversations.senderId, pageCol: conversations.pageId },
        { from: messages, idCol: messages.senderId, pageCol: messages.pageId },
        { from: conversationPauses, idCol: conversationPauses.senderId, pageCol: conversationPauses.pageId },
        { from: leads, idCol: leads.senderId, pageCol: leads.pageId },
    ];
    for (const s of dmSources) {
        for (const batch of chunked(ids, CHUNK)) {
            const rows = await db.select({ pageId: s.pageCol, senderId: s.idCol }).from(s.from).where(inArray(s.idCol, batch));
            for (const r of rows) add(r.pageId, r.senderId);
        }
    }
    // Comment tables — page_id via the parent post / media.
    for (const batch of chunked(ids, CHUNK)) {
        const fbRows = await db.select({ pageId: posts.pageId, senderId: comments.fromId })
            .from(comments).innerJoin(posts, eq(comments.postId, posts.id))
            .where(inArray(comments.fromId, batch));
        for (const r of fbRows) add(r.pageId, r.senderId);
        const igRows = await db.select({ pageId: instagramMedia.pageId, senderId: instagramComments.fromId })
            .from(instagramComments).innerJoin(instagramMedia, eq(instagramComments.mediaId, instagramMedia.id))
            .where(inArray(instagramComments.fromId, batch));
        for (const r of igRows) add(r.pageId, r.senderId);
    }

    if (agg.size === 0) return [];

    const meta = new Map<string, { name: string | null; facebookPageId: string | null; merchant: string | null }>();
    for (const batch of chunked([...agg.keys()], CHUNK)) {
        const rows = await db.select({
            id: pages.id,
            name: pages.name,
            facebookPageId: pages.facebookPageId,
            merchant: workspaces.name,
        }).from(pages).leftJoin(workspaces, eq(pages.workspaceId, workspaces.id)).where(inArray(pages.id, batch));
        for (const r of rows) meta.set(r.id, { name: r.name, facebookPageId: r.facebookPageId, merchant: r.merchant });
    }

    return [...agg.entries()]
        .map(([pageId, e]) => ({
            pageId,
            pageName: meta.get(pageId)?.name ?? null,
            facebookPageId: meta.get(pageId)?.facebookPageId ?? null,
            merchant: meta.get(pageId)?.merchant ?? null,
            matchedIdCount: e.ids.size,
            matchedRows: e.rows,
        }))
        .sort((a, b) => b.matchedRows - a.matchedRows);
}

async function deleteMatches(target: typeof TARGETS[number], ids: string[]): Promise<number> {
    let deleted = 0;
    for (const batch of chunked(ids, CHUNK)) {
        const removed = await db
            .delete(target.table)
            .where(inArray(target.col, batch))
            .returning({ id: target.table.id });
        deleted += removed.length;
    }
    return deleted;
}

async function main() {
    const args = process.argv.slice(2);
    const confirm = args.includes('--confirm');
    const filePath = args.find(a => !a.startsWith('--'));

    if (!filePath) {
        console.error('Usage: gdpr-batch-delete.ts <path-to-ids-file> [--confirm]');
        process.exit(1);
    }

    const startedAt = new Date().toISOString();
    console.log('=== GDPR Batch Data Deletion ===');
    console.log(`Time:    ${startedAt}`);
    console.log(`File:    ${filePath}`);
    console.log(`Mode:    ${confirm ? 'CONFIRM (will delete)' : 'DRY-RUN (no changes)'}\n`);

    const raw = readFileSync(filePath, 'utf-8');
    const ids = parseIds(raw);
    console.log(`Parsed ${ids.length} unique Meta ID(s) from the file.\n`);
    if (ids.length === 0) {
        console.error('No IDs parsed — check the file format. Aborting.');
        process.exit(1);
    }

    // End-customer tables.
    const perTable: Record<string, { matchedIds: string[]; rows: number; deleted?: number }> = {};
    const allMatchedIds = new Set<string>();
    let totalRows = 0;

    for (const target of TARGETS) {
        const { ids: matchedIds, rows } = await countMatches(target, ids);
        perTable[target.name] = { matchedIds, rows };
        matchedIds.forEach(id => allMatchedIds.add(id));
        totalRows += rows;
        console.log(`  ${target.name.padEnd(20)} ${rows} row(s) across ${matchedIds.length} matched ID(s)`);
    }

    // Merchant accounts — REPORT ONLY, never auto-delete.
    const merchantMatches: string[] = [];
    for (const batch of chunked(ids, CHUNK)) {
        const found = await db
            .select({ id: users.id, facebookId: users.facebookId, email: users.email })
            .from(users)
            .where(inArray(users.facebookId, batch));
        for (const u of found) {
            merchantMatches.push(u.facebookId ?? '?');
            console.log(`  ⚠️  MERCHANT MATCH (NOT deleted): users.id=${u.id} fb_id=${u.facebookId} email=${u.email ?? '?'}`);
        }
    }

    console.log(`\n  ${allMatchedIds.size} of ${ids.length} requested ID(s) found across customer tables (${totalRows} total rows).`);
    if (merchantMatches.length > 0) {
        console.log(`  ${merchantMatches.length} ID(s) match a MERCHANT account — review/delete those manually via the account-deletion flow.`);
    }

    // Which pages / merchants were touched (the request itself names none).
    const affectedPages = await resolveAffectedPages(ids);
    if (affectedPages.length > 0) {
        console.log('\n--- Affected pages / merchants ---');
        for (const p of affectedPages) {
            console.log(`  ${(p.pageName ?? '(unnamed)').slice(0, 28).padEnd(28)} fb_page=${p.facebookPageId ?? '?'}  merchant=${p.merchant ?? '?'}  (${p.matchedIdCount} customer ID(s), ${p.matchedRows} row(s))`);
        }
    }

    if (confirm && allMatchedIds.size > 0) {
        console.log('\n--- Deleting ---');
        // messages before conversations so per-table counts are clean (deleting a
        // conversation also cascades its messages via messages.conversation_id FK).
        const order = ['conversation_pauses', 'leads', 'comments', 'instagram_comments', 'messages', 'conversations'];
        for (const name of order) {
            const target = TARGETS.find(t => t.name === name)!;
            const matchedIds = perTable[name].matchedIds;
            if (matchedIds.length === 0) continue;
            const deleted = await deleteMatches(target, matchedIds);
            perTable[name].deleted = deleted;
            console.log(`  ${name.padEnd(20)} deleted ${deleted} row(s)`);
        }
    }

    // Compliance report — proof of which IDs were purged. Contains PSIDs (PII):
    // retain only as long as needed to evidence the deletion, then remove.
    const report = {
        startedAt,
        finishedAt: new Date().toISOString(),
        mode: confirm ? 'confirm' : 'dry-run',
        inputFile: filePath,
        requestedIdCount: ids.length,
        matchedIdCount: allMatchedIds.size,
        totalCustomerRows: totalRows,
        perTable,
        affectedPages,
        merchantMatches,
    };
    const reportPath = `${filePath}.gdpr-report-${startedAt.replace(/[:.]/g, '-')}.json`;
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\nReport written: ${reportPath}`);

    if (!confirm && allMatchedIds.size > 0) {
        console.log('\nDRY-RUN only. Re-run with --confirm to delete the matched rows.');
    }
}

main()
    .then(async () => { await client.end(); process.exit(0); })
    .catch(async (err) => {
        console.error('GDPR batch deletion failed:', err);
        await client.end();
        process.exit(1);
    });
