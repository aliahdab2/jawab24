#!/usr/bin/env npx tsx
/**
 * Refund a Stripe charge or payment intent.
 *
 * Usage:
 *   npx tsx scripts/refund-charge.ts <id> --reason "<text>" [--operator <email>]
 *   npx tsx scripts/refund-charge.ts <id> --reason "<text>" --apply
 *
 * <id> is either a charge ID (ch_...) or a payment intent ID (pi_...).
 * Default is dry-run; pass --apply to actually issue the refund.
 */

import dotenv from 'dotenv';
dotenv.config();

import { stripe } from '../src/services/stripe';

interface Args {
    id: string;
    reason: string;
    operator: string | null;
    apply: boolean;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
        usage();
        process.exit(1);
    }

    const id = argv[0];
    let reason = '';
    let operator: string | null = null;
    let apply = false;

    for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--reason') {
            reason = argv[++i] ?? '';
        } else if (argv[i] === '--operator') {
            operator = argv[++i] ?? null;
        } else if (argv[i] === '--apply') {
            apply = true;
        }
    }

    if (!id || !reason) {
        usage();
        process.exit(1);
    }

    return { id, reason, operator, apply };
}

function usage() {
    console.error('Usage: npx tsx scripts/refund-charge.ts <ch_... | pi_...> --reason "<text>" [--operator <email>] [--apply]');
}

async function main() {
    const args = parseArgs();

    if (!stripe) {
        console.error('Stripe is not configured. Set STRIPE_SECRET_KEY in backend/.env.');
        process.exit(1);
    }

    const params: Parameters<typeof stripe.refunds.create>[0] = {
        metadata: {
            reason: args.reason,
            operator: args.operator ?? 'unknown',
            issued_via: 'refund-charge.ts',
        },
    };

    if (args.id.startsWith('ch_')) {
        params.charge = args.id;
    } else if (args.id.startsWith('pi_')) {
        params.payment_intent = args.id;
    } else {
        console.error(`ID must start with ch_ (charge) or pi_ (payment intent). Got: ${args.id}`);
        process.exit(1);
    }

    console.log('\nRefund preview');
    console.log(`  target:    ${args.id}`);
    console.log(`  reason:    ${args.reason}`);
    console.log(`  operator:  ${args.operator ?? '(none)'}`);
    console.log(`  mode:      ${args.apply ? 'APPLY' : 'dry run'}\n`);

    if (!args.apply) {
        console.log('Dry run. Re-run with --apply to issue the refund.');
        process.exit(0);
    }

    const refund = await stripe.refunds.create(params);
    console.log(`Refund created: ${refund.id}`);
    console.log(`  amount:    ${refund.amount / 100} ${refund.currency.toUpperCase()}`);
    console.log(`  status:    ${refund.status}`);
    console.log(`  charge:    ${refund.charge}`);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
