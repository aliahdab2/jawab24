/**
 * Activation Funnel — Integration Tests (real Postgres)
 *
 * Covers the read side that backs GET /admin/activation-funnel (getActivationFunnel)
 * and the idempotency guarantee of recordActivationEvent:
 *   1. Cohort is scoped to signups inside the window; older signups are excluded.
 *   2. Per-step counts reflect how many of the cohort reached each milestone.
 *   3. Median hours from signup → first auto-reply is computed over those who got there.
 *   4. recordActivationEvent is idempotent per (user, event) and keeps the first metadata.
 *
 * The HTTP handler itself is a thin clamp-and-delegate (days → 1..365, default 30),
 * so the funnel logic is exercised directly against the DB here.
 */

import { describe, it, expect } from 'vitest';
import { createTestUser } from './setup';
import { testDb } from './setup';
import { activationEvents } from '../../src/db/schema';
import { eq, and } from 'drizzle-orm';
import {
    getActivationFunnel,
    recordActivationEvent,
    type ActivationEvent,
} from '../../src/services/activation';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Insert an activation event with an explicit timestamp (bypasses defaultNow). */
async function seedEvent(userId: string, event: ActivationEvent, at: Date) {
    await testDb.insert(activationEvents).values({ userId, event, createdAt: at });
}

describe('Activation funnel', () => {
    it('counts cohort steps and median time-to-first-reply, excluding out-of-window signups', async () => {
        const now = Date.now();
        const within = (hoursAgo: number) => new Date(now - hoursAgo * HOUR);

        // A: full funnel, signup 10h ago, first reply 8h ago → 2h to first reply
        const a = await createTestUser({ facebookId: 'fnl-a' });
        await seedEvent(a.id, 'signup', within(10));
        await seedEvent(a.id, 'page_connected', within(9.5));
        await seedEvent(a.id, 'kb_filled', within(9));
        await seedEvent(a.id, 'autoreply_enabled', within(8.5));
        await seedEvent(a.id, 'first_autoreply_sent', within(8));

        // F: full funnel, signup 20h ago, first reply 14h ago → 6h to first reply
        const f = await createTestUser({ facebookId: 'fnl-f' });
        await seedEvent(f.id, 'signup', within(20));
        await seedEvent(f.id, 'page_connected', within(19));
        await seedEvent(f.id, 'kb_filled', within(18));
        await seedEvent(f.id, 'autoreply_enabled', within(17));
        await seedEvent(f.id, 'first_autoreply_sent', within(14));

        // B: stops after KB
        const b = await createTestUser({ facebookId: 'fnl-b' });
        await seedEvent(b.id, 'signup', within(5));
        await seedEvent(b.id, 'page_connected', within(4));
        await seedEvent(b.id, 'kb_filled', within(3));

        // C: stops after connecting a page
        const c = await createTestUser({ facebookId: 'fnl-c' });
        await seedEvent(c.id, 'signup', within(5));
        await seedEvent(c.id, 'page_connected', within(4));

        // D: signed up only
        const d = await createTestUser({ facebookId: 'fnl-d' });
        await seedEvent(d.id, 'signup', within(2));

        // E: signed up 40 days ago AND sent a reply — must be excluded from a 30-day window
        const e = await createTestUser({ facebookId: 'fnl-e' });
        await seedEvent(e.id, 'signup', new Date(now - 40 * DAY));
        await seedEvent(e.id, 'page_connected', new Date(now - 40 * DAY + HOUR));
        await seedEvent(e.id, 'first_autoreply_sent', new Date(now - 39 * DAY));

        const funnel = await getActivationFunnel(30);

        const count = (key: ActivationEvent) =>
            funnel.steps.find((s) => s.key === key)?.count;

        // Cohort = A, F, B, C, D (E excluded — signup is outside the 30d window)
        expect(count('signup')).toBe(5);
        expect(count('page_connected')).toBe(4); // A, F, B, C
        expect(count('kb_filled')).toBe(3); // A, F, B
        expect(count('autoreply_enabled')).toBe(2); // A, F
        expect(count('first_autoreply_sent')).toBe(2); // A, F (NOT E)

        // Steps are returned in funnel order
        expect(funnel.steps.map((s) => s.key)).toEqual([
            'signup', 'page_connected', 'kb_filled', 'autoreply_enabled', 'first_autoreply_sent',
        ]);

        // Median of {2h, 6h} = 4h
        expect(funnel.medianHoursToFirstReply).toBeCloseTo(4, 5);
        expect(funnel.days).toBe(30);
    });

    it('counts a cohort user\'s milestone even when the milestone lands outside the window', async () => {
        // The cohort filter windows on the SIGNUP event only; the join to a user's
        // milestones is deliberately NOT windowed. A user who signed up inside the
        // window but whose first reply happened long after (outside it) must still
        // count toward first_autoreply_sent. This pins that intent.
        const now = Date.now();
        const u = await createTestUser({ facebookId: 'fnl-latejoin' });
        await seedEvent(u.id, 'signup', new Date(now - 5 * DAY)); // in 30d window
        await seedEvent(u.id, 'page_connected', new Date(now - 4 * DAY));
        await seedEvent(u.id, 'first_autoreply_sent', new Date(now - 100 * DAY)); // outside window

        const funnel = await getActivationFunnel(30);
        expect(funnel.steps.find((s) => s.key === 'signup')?.count).toBe(1);
        expect(funnel.steps.find((s) => s.key === 'first_autoreply_sent')?.count).toBe(1);
    });

    it('allows non-monotonic counts (a later step can exceed an earlier one)', async () => {
        // A page can send a template auto-reply without ever filling a KB, so
        // first_autoreply_sent (and autoreply_enabled) can legitimately exceed
        // kb_filled. The query must report the true reached-counts, not force a
        // monotonic shape — the panel is responsible for rendering this honestly.
        const now = Date.now();
        const recent = (d: number) => new Date(now - d * HOUR);
        const u1 = await createTestUser({ facebookId: 'fnl-nm-1' });
        await seedEvent(u1.id, 'signup', recent(5));
        await seedEvent(u1.id, 'page_connected', recent(4));
        await seedEvent(u1.id, 'autoreply_enabled', recent(3));
        await seedEvent(u1.id, 'first_autoreply_sent', recent(2)); // no kb_filled
        const u2 = await createTestUser({ facebookId: 'fnl-nm-2' });
        await seedEvent(u2.id, 'signup', recent(5));
        await seedEvent(u2.id, 'page_connected', recent(4)); // stops here

        const funnel = await getActivationFunnel(30);
        const count = (k: ActivationEvent) => funnel.steps.find((s) => s.key === k)?.count;
        expect(count('page_connected')).toBe(2);
        expect(count('kb_filled')).toBe(0); // earlier step
        expect(count('autoreply_enabled')).toBe(1); // later step > earlier step
        expect(count('first_autoreply_sent')).toBe(1);
    });

    it('returns a zeroed funnel and null median when no one reached the first reply', async () => {
        const u = await createTestUser({ facebookId: 'fnl-nomedian' });
        await seedEvent(u.id, 'signup', new Date());
        await seedEvent(u.id, 'page_connected', new Date());

        const funnel = await getActivationFunnel(30);

        expect(funnel.steps.find((s) => s.key === 'signup')?.count).toBe(1);
        expect(funnel.steps.find((s) => s.key === 'first_autoreply_sent')?.count).toBe(0);
        expect(funnel.medianHoursToFirstReply).toBeNull();
    });

    it('recordActivationEvent is idempotent per (user, event) and keeps the first metadata', async () => {
        const u = await createTestUser({ facebookId: 'fnl-idem' });

        await recordActivationEvent(u.id, 'first_autoreply_sent', { pageId: 'page-1', channel: 'comment' });
        await recordActivationEvent(u.id, 'first_autoreply_sent', { pageId: 'page-2', channel: 'message' });

        const rows = await testDb
            .select()
            .from(activationEvents)
            .where(and(eq(activationEvents.userId, u.id), eq(activationEvents.event, 'first_autoreply_sent')));

        // Only the first emit persisted...
        expect(rows).toHaveLength(1);
        // ...and its metadata won (page-1), not the second emit's (page-2).
        expect((rows[0].metadata as { pageId?: string }).pageId).toBe('page-1');
    });
});
