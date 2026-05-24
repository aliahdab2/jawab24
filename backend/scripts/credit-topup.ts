#!/usr/bin/env npx ts-node
/**
 * Credit a top-up pack to a user (manual purchase flow).
 *
 * Use when a user has paid via bank transfer / USDT / WhatsApp / cash and
 * you need to credit their balance. The Stripe self-service flow lives in
 * the app — this script is for everything else.
 *
 * Usage:
 *   npx tsx backend/scripts/credit-topup.ts --user=<userId> --pack=<5k|10k> [--ref=<externalRef>] [--note=<note>]
 *
 * Examples:
 *   # Bank transfer credit
 *   npx tsx backend/scripts/credit-topup.ts --user=8f1c9... --pack=10k --ref="BANK-TX-2026-05-24-001" --note="Paid via Saudi NB"
 *
 *   # USDT credit
 *   npx tsx backend/scripts/credit-topup.ts --user=8f1c9... --pack=5k --ref="0xabc...def" --note="USDT TRC20"
 *
 *   # Quick WhatsApp credit (no formal reference)
 *   npx tsx backend/scripts/credit-topup.ts --user=8f1c9... --pack=10k --note="WhatsApp 2026-05-24"
 */

import dotenv from 'dotenv';
dotenv.config();

import { topupService, TopupUserNotFoundError, UnknownTopupPackError } from '../src/services/topup';
import type { TopupPack } from '../src/services/topup';

interface Args {
    userId?: string;
    pack?: string;
    ref?: string;
    note?: string;
}

function parseArgs(argv: string[]): Args {
    const args: Args = {};
    for (const raw of argv) {
        const m = raw.match(/^--([^=]+)=(.*)$/);
        if (!m) continue;
        const [, key, value] = m;
        if (key === 'user') args.userId = value;
        else if (key === 'pack') args.pack = value;
        else if (key === 'ref') args.ref = value;
        else if (key === 'note') args.note = value;
    }
    return args;
}

function usage(): never {
    console.log(`
Credit a top-up pack to a user.

Usage:
  npx tsx backend/scripts/credit-topup.ts --user=<userId> --pack=<5k|10k> [--ref=<externalRef>] [--note=<note>]

Required:
  --user=<uuid>   Target user ID
  --pack=<5k|10k> Pack to credit

Optional:
  --ref=<string>  External reference (bank tx ID, USDT TXID, WhatsApp ref)
  --note=<string> Free-form admin note

Example:
  npx tsx backend/scripts/credit-topup.ts --user=8f1c9bee-... --pack=10k --ref="BANK-TX-001" --note="Paid via Saudi NB"
`);
    process.exit(1);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.userId || !args.pack) usage();
    if (args.pack !== '5k' && args.pack !== '10k') {
        console.error(`❌ Invalid pack: ${args.pack}. Must be '5k' or '10k'.`);
        process.exit(1);
    }

    try {
        const result = await topupService.creditTopup({
            userId: args.userId,
            pack: args.pack as TopupPack,
            source: 'manual',
            externalRef: args.ref,
        });

        console.log(`✓ Credited ${result.repliesAdded} replies to ${args.userId}`);
        console.log(`  Purchase ID: ${result.purchaseId}`);
        console.log(`  New top-up balance: ${result.newBalance}`);
        if (args.note) console.log(`  Note: ${args.note}`);
        if (args.ref) console.log(`  External ref: ${args.ref}`);
        console.log('');
        console.log('⚠ This CLI does not write to admin_audit_logs. Prefer POST /admin/topup');
        console.log('  for production credits so the action is traceable in the admin UI.');

        process.exit(0);
    } catch (err) {
        if (err instanceof TopupUserNotFoundError) {
            console.error(`❌ User not found: ${args.userId}`);
            process.exit(2);
        }
        if (err instanceof UnknownTopupPackError) {
            console.error(`❌ ${err.message}`);
            process.exit(3);
        }
        console.error('❌ Top-up credit failed:', err);
        process.exit(1);
    }
}

main();
