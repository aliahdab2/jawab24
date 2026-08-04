/**
 * Integration test: WHICH leads the daily digest reports (real Postgres).
 *
 * The unit suite (`src/__tests__/leadDigest.test.ts`) mocks `db`, so it hands the
 * service a fixed row set and can never prove the SQL predicate. That predicate
 * is the whole point here: the digest must report the same set the nav badge and
 * the dashboard attention row count — leads still WAITING for contact
 * (`status = 'new'`) that have not been digested yet.
 *
 * Origin (2026-08-04): the digest selected every un-stamped lead regardless of
 * status. Harmless while DIGEST_THRESHOLD kept low-volume workspaces silent, but
 * the age trigger reaches them, so a merchant who contacted and converted his one
 * lead on day one would be emailed "you have 1 new lead" on day two while the
 * dashboard correctly showed zero waiting.
 *
 * Only the email transport is mocked (a third-party external). The lead query,
 * the trigger evaluation, the subscription gate and the stamping all hit the DB.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.hoisted: vi.mock is lifted above the imports, so the factory cannot close
// over an ordinary top-level const (it would not be initialized yet).
// Mirrors emailService.send's real SendResult — `success` is what the digest
// branches on; a bare `{id}` books every send as a transient failure.
const { emailSendMock } = vi.hoisted(() => ({
    emailSendMock: vi.fn().mockResolvedValue({ success: true, id: 'email-1', emailSendId: null }),
}));
vi.mock('../../src/services/email', () => ({
    emailService: { send: emailSendMock, setLogger: vi.fn() },
}));

import { eq, inArray } from 'drizzle-orm';
import {
    createTestUser,
    createTestWorkspace,
    createTestPage,
    testDb,
} from './setup';
import * as schema from '../../src/db/schema';
import { runDailyLeadDigest, DIGEST_MAX_AGE_HOURS } from '../../src/services/leadDigest';

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
const STALE = () => hoursAgo(DIGEST_MAX_AGE_HOURS + 1);

// Plans are NOT truncated by the shared setup (subscriptions reference them with
// ON DELETE RESTRICT), so create one per test and clean it up.
const createdPlanIds: string[] = [];
afterEach(async () => {
    for (const id of createdPlanIds.splice(0)) {
        await testDb.delete(schema.plans).where(eq(schema.plans.id, id)).catch(() => { });
    }
});

/** An engaged owner with an active subscription — every recipient gate passes. */
async function seedWorkspace() {
    const user = await createTestUser({ email: 'owner@shop.test', lastSeenAt: new Date() });
    const workspace = await createTestWorkspace(user.id);
    const page = await createTestPage(user.id, {
        workspaceId: workspace.id,
        knowledgeBase: 'We sell electronics and gadgets.',
    });

    const [plan] = await testDb.insert(schema.plans)
        .values({ name: 'Starter', slug: `starter-${Date.now()}`, price: 0 })
        .returning();
    createdPlanIds.push(plan.id);
    await testDb.insert(schema.subscriptions)
        .values({ userId: user.id, planId: plan.id, status: 'active' });

    return { user, workspace, page };
}

let leadSeq = 0;
async function insertLead(
    pageId: string,
    overrides: Partial<typeof schema.leads.$inferInsert> = {},
) {
    leadSeq += 1;
    const [lead] = await testDb.insert(schema.leads).values({
        pageId,
        senderId: `sender-${leadSeq}-${Math.random().toString(36).slice(2, 8)}`,
        senderName: `Customer ${leadSeq}`,
        phone: `+96355500${String(leadSeq).padStart(4, '0')}`,
        status: 'new',
        createdAt: STALE(),
        ...overrides,
    }).returning();
    return lead;
}

describe('lead digest — which leads it reports (real Postgres)', () => {
    beforeEach(() => {
        emailSendMock.mockClear();
    });

    it('does NOT email about a lead the merchant already contacted', async () => {
        const { page } = await seedWorkspace();
        await insertLead(page.id, { status: 'contacted' });

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        // No workspace even enters the loop — a worked lead is not a waiting lead.
        expect(result.processed).toBe(0);
        expect(result.sent).toBe(0);
    });

    it('does NOT email about a converted lead', async () => {
        const { page } = await seedWorkspace();
        await insertLead(page.id, { status: 'converted' });

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(result.processed).toBe(0);
    });

    it('DOES email about a stale lead still waiting at `new` (age flush)', async () => {
        const { page } = await seedWorkspace();
        await insertLead(page.id, { status: 'new' });

        const result = await runDailyLeadDigest();

        expect(emailSendMock).toHaveBeenCalledTimes(1);
        expect(result.sent).toBe(1);
    });

    it('counts and stamps ONLY the waiting leads when the queue is mixed', async () => {
        const { page } = await seedWorkspace();
        const waiting = await insertLead(page.id, { status: 'new', senderName: 'Waiting One' });
        const contacted = await insertLead(page.id, { status: 'contacted', senderName: 'Worked One' });
        const converted = await insertLead(page.id, { status: 'converted', senderName: 'Closed One' });

        const result = await runDailyLeadDigest();

        expect(result.sent).toBe(1);
        expect(emailSendMock).toHaveBeenCalledTimes(1);

        // The email must describe one waiting customer, not three leads.
        const [[sendArgs]] = emailSendMock.mock.calls as unknown as Array<[{ subject: string; html: string }]>;
        expect(sendArgs.html).toContain('Waiting One');
        expect(sendArgs.html).not.toContain('Worked One');
        expect(sendArgs.html).not.toContain('Closed One');

        // Stamping follows the same set: a worked lead is never marked "digested",
        // so moving it back to `new` later makes it eligible again.
        const rows = await testDb
            .select({ id: schema.leads.id, digestEmailedAt: schema.leads.digestEmailedAt })
            .from(schema.leads)
            .where(inArray(schema.leads.id, [waiting.id, contacted.id, converted.id]));
        const stamped = Object.fromEntries(rows.map(r => [r.id, r.digestEmailedAt !== null]));
        expect(stamped[waiting.id]).toBe(true);
        expect(stamped[contacted.id]).toBe(false);
        expect(stamped[converted.id]).toBe(false);
    });

    it('a fresh waiting lead below the threshold still does not fire', async () => {
        const { page } = await seedWorkspace();
        await insertLead(page.id, { status: 'new', createdAt: hoursAgo(1) });

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(result.skipped).toBe(1);
    });

    it('never re-emails a lead that was already digested', async () => {
        const { page } = await seedWorkspace();
        await insertLead(page.id, { status: 'new', digestEmailedAt: new Date() });

        const result = await runDailyLeadDigest();

        expect(emailSendMock).not.toHaveBeenCalled();
        expect(result.processed).toBe(0);
    });
});
