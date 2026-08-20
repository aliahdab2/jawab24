/**
 * Admin customer detail — usage health flags read the REAL top-up balance
 * (real Postgres, real getUserDetail).
 *
 * The unit tests around computeHealthFlags prove the policy; they cannot prove
 * the WIRING. `HealthInput.usage.topupBalance` is a required field, so the type
 * checker forces getUserDetail to pass *a* number — it would happily accept a
 * hardcoded 0, which is exactly the bug that shipped (a merchant with 9,417
 * top-up replies told "replies will go silent at the cap"). These tests read the
 * balance out of the users table through the real service to close that gap.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';
import { adminUsersService } from '../../src/services/admin/users';

// Plans are NOT truncated by the shared setup (subscriptions reference them with
// ON DELETE RESTRICT), so create them per-test and clean up here. The referencing
// subscriptions go first — deleting the plan while a subscription still points at
// it fails, and a swallowed failure would leak rows that collide with the unique
// slug on the next run. Slugs also carry a per-run suffix so a leak from an
// interrupted run can never wedge the suite.
const createdPlanIds: string[] = [];

afterEach(async () => {
    for (const id of createdPlanIds.splice(0)) {
        await testDb.delete(schema.subscriptions).where(eq(schema.subscriptions.planId, id));
        await testDb.delete(schema.plans).where(eq(schema.plans.id, id));
    }
});

async function createPlanWithCap(label: string, maxAiRepliesPerMonth: number) {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [plan] = await testDb
        .insert(schema.plans)
        .values({ name: `Plan ${label}`, slug, price: 0, maxAiRepliesPerMonth })
        .returning();
    createdPlanIds.push(plan.id);
    return plan;
}

/**
 * A merchant mid-period: active subscription on a capped plan, `used` replies
 * consumed, and `topupBalance` non-expiring replies in the bank.
 *
 * The settings row matters: computeHealthFlags reads `limitFallbackEnabled ===
 * false`, so a merchant with NO settings row can never raise limit_fallback_off
 * and every assertion about it would pass vacuously. Real accounts always have
 * one, so seed it at the schema default (fallback OFF).
 */
async function seedMerchant(opts: { used: number; cap: number; topupBalance: number; slug: string }) {
    const user = await createTestUser({
        facebookId: `fb-${opts.slug}`,
        email: `${opts.slug}@shop.com`,
        topupBalance: opts.topupBalance,
    });
    await testDb.insert(schema.settings).values({ userId: user.id, limitFallbackEnabled: false });
    const plan = await createPlanWithCap(opts.slug, opts.cap);
    await testDb.insert(schema.subscriptions).values({
        userId: user.id, planId: plan.id, status: 'active',
    });
    const now = new Date();
    await testDb.insert(schema.usage).values({
        userId: user.id,
        aiRepliesCount: opts.used,
        periodStart: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        periodEnd: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });
    return user;
}

const flagKeys = (flags: { key: string }[]) => flags.map(f => f.key);

describe('adminUsersService.getUserDetail — usage flags vs top-up balance (integration)', () => {
    it('surfaces the stored balance and drops the false "replies will stop" flag', async () => {
        // The live report: 8,746 of 10,000 plan replies, 9,417 top-up in the bank.
        const user = await seedMerchant({ used: 8746, cap: 10000, topupBalance: 9417, slug: 'near-cap-covered' });

        const detail = await adminUsersService.getUserDetail(user.id);

        expect(detail).not.toBeNull();
        expect(detail!.topupBalance).toBe(9417);
        const keys = flagKeys(detail!.health);
        expect(keys).toContain('usage_near_cap_on_topup');
        // The two lines that were wrong on the live page.
        expect(keys).not.toContain('limit_fallback_off');
        expect(keys).not.toContain('usage_over_cap');
        // The balance really came from the row, not a placeholder.
        const flag = detail!.health.find(f => f.key === 'usage_near_cap_on_topup');
        expect(flag?.meta).toMatchObject({ used: 8746, limit: 10000, balance: 9417 });
    });

    it('a merchant with no balance still gets the red wall + fallback warning', async () => {
        const user = await seedMerchant({ used: 1000, cap: 1000, topupBalance: 0, slug: 'at-cap-uncovered' });

        const detail = await adminUsersService.getUserDetail(user.id);

        const keys = flagKeys(detail!.health);
        expect(keys).toContain('usage_over_cap');
        expect(keys).toContain('limit_fallback_off');
        expect(detail!.health.find(f => f.key === 'usage_over_cap')?.severity).toBe('red');
    });

    it('a nearly-drained balance is flagged, not silently treated as covered', async () => {
        const user = await seedMerchant({ used: 1000, cap: 1000, topupBalance: 3, slug: 'topup-drained' });

        const detail = await adminUsersService.getUserDetail(user.id);

        const keys = flagKeys(detail!.health);
        expect(keys).toContain('usage_topup_nearly_drained');
        expect(keys).not.toContain('usage_on_topup');
        expect(detail!.health.find(f => f.key === 'usage_topup_nearly_drained')?.severity).toBe('yellow');
    });
});

/**
 * The admin console's per-page "disconnected" badge.
 *
 * It was computed from the FACEBOOK access token alone. A WhatsApp-only card has
 * no Facebook page and therefore no Facebook token by definition, so every
 * healthy WhatsApp number rendered as disconnected — sending support to hunt a
 * fault that was never there, on the channel we had just launched publicly.
 */
describe('adminUsersService.getUserDetail — per-page connection state', () => {
    it('does not report a healthy WhatsApp-only card as disconnected', async () => {
        const user = await createTestUser();
        await testDb.insert(schema.pages).values({
            userId: user.id,
            name: 'WhatsApp Only',
            facebookPageId: null,
            accessToken: '',                 // NOT NULL column; a WhatsApp-only card stores empty
            whatsappPhoneNumberId: `pn-${Date.now()}`,
            whatsappAccessToken: 'wa-token', // the credential that actually matters here
        });

        const detail = await adminUsersService.getUserDetail(user.id);
        const page = detail!.pages.find(p => p.name === 'WhatsApp Only');

        expect(page).toBeDefined();
        expect(page!.disconnected).toBe(false);
        // And the WhatsApp identity must reach the admin payload at all — without
        // it the console cannot tell a WhatsApp card from a broken Facebook one.
        expect(page!.whatsappPhoneNumberId).toBeTruthy();
    });

    it('still reports a Facebook page with no token as disconnected', async () => {
        const user = await createTestUser();
        await testDb.insert(schema.pages).values({
            userId: user.id,
            name: 'Dead FB Page',
            facebookPageId: `fb-${Date.now()}`,
            accessToken: '',
        });

        const detail = await adminUsersService.getUserDetail(user.id);
        const page = detail!.pages.find(p => p.name === 'Dead FB Page');

        expect(page!.disconnected).toBe(true);
    });
});

/**
 * The mode a page RUNS with must reach the support console (D-087).
 *
 * Support's ticket for this is «توقف عن أخذ أرقام الزبائن» — the assistant
 * stopped taking customer numbers. The answer is the reply mode, and it resolves
 * page-pin-then-workspace-default: measured on prod 2026-08-20, 3 of the 4
 * info-pinned pages sat under a 'sales' workspace default, so a console showing
 * only the workspace value reports "sales" for a page running INFO-DESK and
 * sends support hunting the prompt instead. Until GA the allowlist was the
 * fallback answer ("only two workspaces can even have it"); D-087 deleted it, so
 * this payload is now the only answer.
 */
describe('adminUsersService.getUserDetail — per-page reply mode', () => {
    it('reports a PINNED info page as info even under a sales workspace default', async () => {
        const user = await createTestUser();
        await testDb.insert(schema.pages).values({
            userId: user.id,
            name: 'Pinned Info',
            facebookPageId: `fb-pin-${Date.now()}`,
            accessToken: 'tok',
            replyMode: 'info',
        });

        const detail = await adminUsersService.getUserDetail(user.id);
        const page = detail!.pages.find(p => p.name === 'Pinned Info');

        expect(page!.replyMode).toBe('info');            // the pin itself
        expect(page!.replyModeEffective).toBe('info');    // what it runs with
    });

    it('reports an INHERITING page, and keeps the pin distinguishable from the default', async () => {
        const user = await createTestUser();
        await testDb.insert(schema.pages).values({
            userId: user.id,
            name: 'Inheriting',
            facebookPageId: `fb-inherit-${Date.now()}`,
            accessToken: 'tok',
            replyMode: null,
        });

        const detail = await adminUsersService.getUserDetail(user.id);
        const page = detail!.pages.find(p => p.name === 'Inheriting');

        // NULL pin, so the effective mode came from the workspace default —
        // support needs both halves: an inherited info is fixed on the workspace,
        // a pinned one is not.
        expect(page!.replyMode).toBeNull();
        expect(page!.replyModeEffective).toBe('sales');
    });
});
