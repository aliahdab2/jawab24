/**
 * Read-only diagnostic for undelivered / flagged DM rows.
 *
 * Surfaces the root cause behind "لم يتم تسليم الرد" (send_failed_retries_exhausted)
 * flags introduced by PRs #136/#137. Tells you whether a backlog of flagged DM rows
 * is deploy-window residue or an active ongoing failure.
 *
 * Usage on prod:
 *   npm --prefix backend run build
 *   SENDER_ID=680540248469010 HOURS=24 node backend/dist/scripts/inspect-undelivered.js
 *
 * No writes. Safe to run any time.
 */

import dotenv from 'dotenv';
import { sql } from 'drizzle-orm';
import { db } from '../db';

dotenv.config();

const SENDER_ID = process.env.SENDER_ID || null;
const HOURS = Math.max(1, parseInt(process.env.HOURS || '24', 10));

function unwrap<T>(result: unknown): T[] {
    if (Array.isArray(result)) return result as T[];
    const maybe = (result as { rows?: T[] }).rows;
    return Array.isArray(maybe) ? maybe : [];
}

type SenderRow = {
    id: string;
    page_id: string;
    created_at: Date | string;
    direction: string;
    message: string;
    replied: boolean;
    reply_method: string | null;
    needs_attention: boolean;
    flag_reason: string | null;
    flag_meta: unknown;
    ai_intent: string | null;
};

async function senderDetail(senderId: string) {
    const result = await db.execute<SenderRow>(sql`
        SELECT id, page_id, created_at, direction, message, replied, reply_method,
               needs_attention, flag_reason, flag_meta, ai_intent
        FROM messages
        WHERE sender_id = ${senderId}
          AND created_at > NOW() - INTERVAL '${sql.raw(String(HOURS))} hours'
        ORDER BY created_at DESC
        LIMIT 50
    `);
    const rows = unwrap<SenderRow>(result);

    console.log(`\n=== Sender ${senderId} — last ${HOURS}h (${rows.length} rows) ===`);
    for (const r of rows) {
        const status = r.replied
            ? `REPLIED via ${r.reply_method ?? '?'}`
            : r.needs_attention
                ? `FLAGGED: ${r.flag_reason ?? '?'}`
                : 'PENDING';
        const preview = (r.message ?? '').slice(0, 60).replace(/\n/g, ' ');
        const ts = new Date(r.created_at).toISOString();
        console.log(
            `  ${ts}  ${r.direction.padEnd(8)}  ${status.padEnd(45)}  "${preview}"`
        );
        if (r.flag_meta) {
            console.log(`      flag_meta: ${JSON.stringify(r.flag_meta)}`);
        }
    }
}

async function flagBreakdown() {
    const result = await db.execute<{ flag_reason: string | null; n: string }>(sql`
        SELECT flag_reason, COUNT(*)::text AS n
        FROM messages
        WHERE needs_attention = true
          AND created_at > NOW() - INTERVAL '${sql.raw(String(HOURS))} hours'
        GROUP BY flag_reason
        ORDER BY n::int DESC
    `);
    const rows = unwrap<{ flag_reason: string | null; n: string }>(result);

    console.log(`\n=== Flag-reason breakdown (last ${HOURS}h, all pages) ===`);
    if (rows.length === 0) {
        console.log('  (no flagged rows)');
        return;
    }
    for (const r of rows) {
        console.log(`  ${String(r.n).padStart(6)}  ${r.flag_reason ?? '(null)'}`);
    }
}

async function hourlyHistogram() {
    const result = await db.execute<{ hour: Date | string; n: string }>(sql`
        SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::text AS n
        FROM messages
        WHERE needs_attention = true
          AND created_at > NOW() - INTERVAL '${sql.raw(String(HOURS))} hours'
        GROUP BY hour
        ORDER BY hour
    `);
    const rows = unwrap<{ hour: Date | string; n: string }>(result);

    console.log(`\n=== Flagged rows per hour (last ${HOURS}h) ===`);
    if (rows.length === 0) {
        console.log('  (no flagged rows)');
        return;
    }
    const max = Math.max(...rows.map(r => parseInt(r.n, 10)));
    for (const r of rows) {
        const n = parseInt(r.n, 10);
        const bar = '█'.repeat(Math.max(1, Math.round((n / max) * 40)));
        const hourLabel = new Date(r.hour).toISOString().slice(0, 13);
        console.log(`  ${hourLabel}  ${String(n).padStart(4)}  ${bar}`);
    }
}

async function topErrorMessages() {
    const result = await db.execute<{ err: string | null; n: string }>(sql`
        SELECT flag_meta->'send_failed_retries_exhausted'->>'error' AS err, COUNT(*)::text AS n
        FROM messages
        WHERE needs_attention = true
          AND flag_reason = 'send_failed_retries_exhausted'
          AND created_at > NOW() - INTERVAL '${sql.raw(String(HOURS))} hours'
        GROUP BY err
        ORDER BY n::int DESC
        LIMIT 15
    `);
    const rows = unwrap<{ err: string | null; n: string }>(result);

    console.log(`\n=== Top error messages for send_failed_retries_exhausted (last ${HOURS}h) ===`);
    if (rows.length === 0) {
        console.log('  (none)');
        return;
    }
    for (const r of rows) {
        console.log(`  ${String(r.n).padStart(4)}  ${(r.err ?? '(no message)').slice(0, 200)}`);
    }
}

async function run() {
    if (SENDER_ID) await senderDetail(SENDER_ID);
    await flagBreakdown();
    await hourlyHistogram();
    await topErrorMessages();
}

if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('inspect-undelivered failed:', err);
            process.exit(1);
        });
}
