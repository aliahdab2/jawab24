/**
 * DRY-RUN analysis (READ-ONLY, NO WRITES): find leads dropped by the "our reply echoes
 * the customer's own number" bug (fixed in f2d4ba7e — see services/leadExtractor.ts
 * `priorBusinessTurns`). It reports the recoverable leads per page so a human can review
 * them BEFORE any backfill insert.
 *
 * It does NOT touch the database. It reads a JSON dump produced by a read-only SELECT
 * (see the SQL in scratchpad/echo_dump.sql) and classifies each candidate with the SAME
 * production logic the gate uses — extractPhones + extractCustomerPhones from
 * @jawab24/shared, the KB business-number exclusion, forwarded-post stripping, and the
 * merchant's timezone region hint — so its verdicts match what production would decide.
 *
 * A row is reported as a DROP only when ALL hold:
 *   1. the customer shared a phone that is THEIRS (survives the KB + forwarded-post + gate
 *      exclusion) — never the merchant's own line;
 *   2. our reply to that message ECHOED that number (the bug's signature);
 *   3. no lead exists for that person under ANY identity (page+sender, phone tail, or name);
 *   4. the message is on/after 2026-06-23 (when #347's exclusion — which the echo poisons —
 *      shipped; earlier drops have other causes and are out of scope here).
 *
 * Usage: npx tsx backend/scripts/analyze-echo-drops.ts <dump.json>
 */
import { readFileSync } from 'fs';
import { extractPhones, extractCustomerPhones } from '@jawab24/shared';
import { countryFromTimezone } from '../src/utils/phoneRegion';

// Mirror of services/leadExtractor.ts — that file is the source of truth. Kept inline
// (not imported) so this read-only script never loads the leadExtractor module and its
// DB/Redis/OpenAI singletons. If the gate's stripping changes, update this too.
const SHARED_POST_BLOCK_RE = /\[Shared post: "[\s\S]*?"\]/g;
function stripForwardedPostBlocks(text: string): string {
    return text
        .replace(SHARED_POST_BLOCK_RE, ' ')
        .replace(/\[Customer shared a post\]/g, ' ')
        .trim();
}

interface CandRow {
    page_id: string;
    page: string;
    kb: string | null;
    timezone: string | null;
    msg_id: string;
    sender_id: string;
    sender_name: string | null;
    message: string;
    reply_text: string;
    created_at: string;
}
interface LeadRow { page_id: string; sender_id: string; sender_name: string | null; phone: string; }

const onlyDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
const tail9 = (s: string) => onlyDigits(s).slice(-9);

const dumpPath = process.argv[2];
if (!dumpPath) { console.error('Usage: tsx analyze-echo-drops.ts <dump.json>'); process.exit(1); }
const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as { candidates: CandRow[]; leads: LeadRow[] };
const candidates = dump.candidates ?? [];
const leads = dump.leads ?? [];

// Existence indexes — a person is "already a lead" if matched by phone tail, exact name,
// or the same (page, sender). Mirrors the Batoul check across every candidate.
const leadTails = new Set(leads.map(l => tail9(l.phone)).filter(t => t.length >= 8));
const leadNames = new Set(leads.map(l => (l.sender_name ?? '').trim()).filter(Boolean));
const leadSenderPage = new Set(leads.map(l => `${l.page_id}|${l.sender_id}`));

// KB business numbers per page (same source as getBusinessPhones: extractPhones(page.kb)).
const kbPhonesCache = new Map<string, string[]>();

interface Drop {
    page: string; pageId: string; senderId: string; msgId: string;
    senderName: string | null; phone: string; summary: string; createdAt: string;
}
const drops = new Map<string, Drop>(); // dedup per person (page|sender)
let echoMatches = 0;
let alreadyLead = 0;

for (const c of candidates) {
    const cc = countryFromTimezone(c.timezone);
    const opts = cc ? { defaultCountry: cc } : undefined;

    let kbPhones = kbPhonesCache.get(c.page_id);
    if (!kbPhones) {
        kbPhones = c.kb ? extractPhones(c.kb, opts).map(p => p.raw) : [];
        kbPhonesCache.set(c.page_id, kbPhones);
    }

    const gateText = stripForwardedPostBlocks(c.message);
    const custPhone = extractCustomerPhones(gateText, kbPhones, opts)[0]?.raw ?? null;
    if (!custPhone) continue;                       // no customer number, or it was the merchant's own
    const t = tail9(custPhone);
    if (t.length < 8) continue;

    if (!onlyDigits(c.reply_text).includes(t)) continue; // our reply didn't echo it → not this bug
    echoMatches++;

    if (leadSenderPage.has(`${c.page_id}|${c.sender_id}`) || leadTails.has(t)
        || (c.sender_name && leadNames.has(c.sender_name.trim()))) {
        alreadyLead++;
        continue;                                   // already captured under some identity
    }

    // Dedup per person; keep the EARLIEST message (the moment the lead should have been created).
    const key = `${c.page_id}|${c.sender_id}`;
    const prev = drops.get(key);
    if (!prev || c.created_at < prev.createdAt) {
        drops.set(key, {
            page: c.page, pageId: c.page_id, senderId: c.sender_id, msgId: c.msg_id,
            senderName: c.sender_name, phone: custPhone,
            summary: c.message.replace(/\s+/g, ' ').trim().slice(0, 280),
            createdAt: c.created_at,
        });
    }
}

const all = [...drops.values()];

// --emit-sql: print idempotent INSERT statements for the backfill (no writes here — this
// only prints SQL for review; run it separately against prod). status='new', created_at
// defaults to now(), ON CONFLICT keeps any lead that appeared meanwhile.
if (process.argv[3] === '--emit-sql') {
    const q = (s: string | null): string => (s === null ? 'NULL' : `'${s.replace(/'/g, "''")}'`);
    const jsonb = (obj: unknown): string => `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
    console.log('BEGIN;');
    for (const d of all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        const extracted = { summary: d.summary, fields: [] as unknown[] };
        console.log(
            `INSERT INTO leads (page_id, source_type, source_id, sender_id, sender_name, phone, extracted_data, status, extraction_status) ` +
            `VALUES (${q(d.pageId)}, 'message', ${q(d.msgId)}, ${q(d.senderId)}, ${q(d.senderName)}, ${q(d.phone)}, ${jsonb(extracted)}, 'new', 'completed') ` +
            `ON CONFLICT (sender_id, page_id) DO NOTHING;  -- ${d.page} | ${d.createdAt.slice(0, 10)}`,
        );
    }
    console.log('COMMIT;');
    process.exit(0);
}

const byPage = new Map<string, Drop[]>();
for (const d of all) {
    const list = byPage.get(d.page) ?? [];
    list.push(d);
    byPage.set(d.page, list);
}

console.log(`Scanned ${candidates.length} candidate messages | ${echoMatches} echoed the customer's number | ${alreadyLead} already a lead\n`);
let total = 0;
for (const [page, list] of [...byPage.entries()].sort((a, b) => b[1].length - a[1].length)) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    console.log(`=== ${page} — ${list.length} recoverable lead(s) ===`);
    for (const d of list) console.log(`  ${d.createdAt.slice(0, 10)}  ${d.phone.padEnd(16)} ${d.senderName}`);
    console.log('');
    total += list.length;
}
console.log(`TOTAL recoverable (echo-dropped, no existing lead): ${total}`);
