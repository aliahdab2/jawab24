import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Invariant: anything that writes the `plans` table must also ask the frontend
 * to revalidate the statically generated pricing pages.
 *
 * `/pricing` is ISR with `revalidate: 3600`, and its client-side refetch only
 * rescues API-unreachable FALLBACK data — real-but-stale data is never
 * refetched. So a plan write that skips `revalidatePlanPages()` leaves every
 * merchant on the old page for up to a full hour with no way to push the
 * update.
 *
 * This shipped: `create-yearly-prices.ts` created the Basic plan's $80/yr
 * Stripe price and wrote `plans.stripe_yearly_price_id`, but never revalidated
 * — so `/api/plans` flipped instantly while the Arabic pricing page kept
 * serving `yearlyAvailable: false` for another hour. `create-monthly-prices.ts`
 * had the identical gap.
 *
 * A file-level assertion (rather than one test per script) is deliberate: the
 * failure mode is a NEW writer forgetting the call, and only a rule that scans
 * the whole directory can catch that one.
 */

const SCRIPTS_DIR = join(__dirname, '../../src/scripts');

/** Writes to the `plans` table, in the two shapes Drizzle produces. */
const PLAN_WRITE = /\b(?:db|tx)\s*\.\s*(?:update|insert|delete)\s*\(\s*plans\s*\)/;

function scriptsWritingPlans(): string[] {
    return readdirSync(SCRIPTS_DIR)
        .filter(f => f.endsWith('.ts'))
        .filter(f => PLAN_WRITE.test(readFileSync(join(SCRIPTS_DIR, f), 'utf8')));
}

describe('scripts that write the plans table', () => {
    it('finds the known plan-writing scripts (guards the detector itself)', () => {
        // If this list empties out — a rename, a refactor to a helper — the
        // rule below would pass vacuously and protect nothing.
        const found = scriptsWritingPlans();
        expect(found).toEqual(
            expect.arrayContaining([
                'create-monthly-prices.ts',
                'create-yearly-prices.ts',
                'seed-plans.ts',
            ]),
        );
    });

    it.each(scriptsWritingPlans())('%s calls revalidatePlanPages()', file => {
        const source = readFileSync(join(SCRIPTS_DIR, file), 'utf8');

        expect(
            source.includes("from '../services/revalidation'"),
            `${file} writes plans but does not import the revalidation service`,
        ).toBe(true);

        expect(
            /revalidatePlanPages\s*\(\s*\)/.test(source),
            `${file} writes plans but never calls revalidatePlanPages() — the pricing page will serve stale data for a full ISR window`,
        ).toBe(true);
    });
});
