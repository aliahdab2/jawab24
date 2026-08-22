/**
 * GA4 activation mirror — the row claim and the signup-session replay (real Postgres).
 *
 * THE DEFECT THIS GUARDS. Until 2026-08-22 the `sign_up` conversion that Google
 * Ads is meant to bid on had never received a single event. The milestone is
 * recorded inside the auth request (`recordActivationEvent(userId, 'signup')`),
 * while the attribution id it needs — `users.ga_client_id` — is posted by the
 * browser only after the dashboard has mounted, with the token that very auth
 * response issued. So at mirror time the id was always still NULL and every
 * `sign_up` resolved `no_client_id`. Ads had a Primary conversion action that
 * was, by construction, empty.
 *
 * The fix replays a user's un-mirrored milestones the moment their id is first
 * stored, and makes both the live mirror and that replay claim each row with
 * `UPDATE activation_events … FROM users WHERE ga_client_id IS NOT NULL AND
 * ga4_mirrored_at IS NULL RETURNING` before sending. As with the purchase
 * claim, the guarantee IS the SQL, and only Postgres can settle what happens
 * when the two paths land at once — a mock can only confirm a condition object
 * was passed.
 *
 * Covers:
 *   1. `sign_up` before the id: unclaimed → the replay sends it once → never again
 *   2. ⛔ a row is never claimed while the id is missing (a burned claim here is
 *      a lost event — the replay only sees rows still unclaimed)
 *   3. the window: an event older than GA4_REPLAY_WINDOW_HOURS is left alone, a
 *      younger one is sent
 *   4. id already stored: the live mirror claims and sends; the replay afterwards
 *      sends nothing
 *   5. the election: a live mirror racing several replays sends exactly once
 *   6. the claim is scoped per user
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestUser, testDb } from './setup';
import { activationEvents } from '../../src/db/schema';
import { config } from '../../src/config';
// The PRODUCTION functions, so the predicates under test cannot drift away
// from the predicates that ship.
import {
    GA4_REPLAY_WINDOW_HOURS,
    recordActivationEvent,
    replayPendingActivationEventsToGa4,
    type ActivationEvent,
} from '../../src/services/activation';
import { storeGaClientIdFirstTouch } from '../../src/services/ga4';

const uid = () => Math.random().toString(36).slice(2, 10);
const HOUR = 60 * 60 * 1000;

/** Every MP send is intercepted — this suite asserts on the CLAIM, and must
 *  never put a test event into the real GA4 property. */
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    // The claim is skipped entirely when GA4 is unconfigured (so an unwired
    // environment cannot stamp a row it can never send), which is the normal
    // state of a test box. Give it credentials so the claim path actually runs.
    vi.spyOn(config, 'ga4', 'get').mockReturnValue({
        measurementId: 'G-INTEGRATION',
        apiSecret: 'secret-integration',
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** Event names GA4 received, in send order. */
function sentEvents(): string[] {
    return fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).events[0].name);
}

function sentClientIds(): string[] {
    return fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).client_id);
}

/** The claim stamp of one (user, event) row — unique by the schema's index. */
async function readStamp(userId: string, event: ActivationEvent): Promise<Date | null> {
    const [row] = await testDb
        .select({ stamp: activationEvents.ga4MirroredAt })
        .from(activationEvents)
        .where(and(eq(activationEvents.userId, userId), eq(activationEvents.event, event)))
        .limit(1);
    return row?.stamp ?? null;
}

/** Insert a milestone with an explicit timestamp (bypasses defaultNow) and no
 *  mirror attempt — the state of every row written before a client id existed. */
async function seedEvent(userId: string, event: ActivationEvent, at: Date) {
    await testDb.insert(activationEvents).values({ userId, event, createdAt: at });
}

const clientId = () => `${Date.now()}${uid().replace(/\D/g, '')}.1700000000`;

describe('activation_events.ga4_mirrored_at — the mirror claim and the signup-session replay', () => {
    it('leaves sign_up unclaimed until the id arrives, then the replay sends it exactly once', async () => {
        const user = await createTestUser({ facebookId: `ga4-replay-${uid()}` });

        // The auth request: the row is written, the id does not exist yet.
        await recordActivationEvent(user.id, 'signup', { method: 'facebook' });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await readStamp(user.id, 'signup')).toBeNull();

        // The dashboard mounts and posts the id — the first-touch write fires
        // the replay (authController.setAnalyticsClientId).
        const id = clientId();
        expect(await storeGaClientIdFirstTouch(user.id, id)).toBe(true);
        await replayPendingActivationEventsToGa4(user.id);

        expect(sentEvents()).toEqual(['sign_up']);
        expect(sentClientIds()).toEqual([id]);
        expect(await readStamp(user.id, 'signup')).toBeInstanceOf(Date);

        // A second replay (two tabs, a retry) finds the row stamped.
        await replayPendingActivationEventsToGa4(user.id);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('⛔ never claims a row while the id is missing — the replay must still be able to see it', async () => {
        const user = await createTestUser({ facebookId: `ga4-noid-${uid()}` });

        await recordActivationEvent(user.id, 'page_connected');

        expect(fetchMock).not.toHaveBeenCalled();
        // The ordering trap: a claim without an id would stamp the row and the
        // replay would never find it — the event lost for good.
        expect(await readStamp(user.id, 'page_connected')).toBeNull();
    });

    it('replays only events inside the window', async () => {
        const stale = await createTestUser({ facebookId: `ga4-stale-${uid()}` });
        const fresh = await createTestUser({ facebookId: `ga4-fresh-${uid()}` });
        // The ~80 accounts that predate id capture: a weeks-old sign_up must not
        // become a conversion when a later login finally stores an id.
        await seedEvent(stale.id, 'signup', new Date(Date.now() - (GA4_REPLAY_WINDOW_HOURS + 1) * HOUR));
        await seedEvent(fresh.id, 'signup', new Date(Date.now() - 1 * HOUR));

        await storeGaClientIdFirstTouch(stale.id, clientId());
        await storeGaClientIdFirstTouch(fresh.id, clientId());
        await replayPendingActivationEventsToGa4(stale.id);
        await replayPendingActivationEventsToGa4(fresh.id);

        expect(sentEvents()).toEqual(['sign_up']);
        expect(await readStamp(stale.id, 'signup')).toBeNull();
        expect(await readStamp(fresh.id, 'signup')).toBeInstanceOf(Date);
    });

    it('mirrors live once the id is stored, and the replay afterwards sends nothing', async () => {
        const user = await createTestUser({ facebookId: `ga4-live-${uid()}` });
        const id = clientId();
        await storeGaClientIdFirstTouch(user.id, id);

        await recordActivationEvent(user.id, 'page_connected');
        expect(sentEvents()).toEqual(['page_connected']);
        expect(sentClientIds()).toEqual([id]);
        expect(await readStamp(user.id, 'page_connected')).toBeInstanceOf(Date);

        // Without the claim the replay would send the same milestone again.
        await replayPendingActivationEventsToGa4(user.id);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    /**
     * `page_connected` is the event that genuinely races the id POST: both fire
     * from the freshly mounted dashboard. Whoever claims second must find the
     * row stamped — which only Postgres can decide, and only here.
     */
    it('elects exactly one sender when the live mirror and replays land concurrently', async () => {
        const user = await createTestUser({ facebookId: `ga4-race-${uid()}` });
        await storeGaClientIdFirstTouch(user.id, clientId());

        await Promise.all([
            recordActivationEvent(user.id, 'page_connected'),
            ...Array.from({ length: 7 }, () => replayPendingActivationEventsToGa4(user.id)),
        ]);

        expect(sentEvents()).toEqual(['page_connected']);
        expect(await readStamp(user.id, 'page_connected')).toBeInstanceOf(Date);
    });

    it('scopes the claim per user — one merchant replaying never touches another', async () => {
        const a = await createTestUser({ facebookId: `ga4-scope-a-${uid()}` });
        const b = await createTestUser({ facebookId: `ga4-scope-b-${uid()}` });
        await recordActivationEvent(a.id, 'signup');
        await recordActivationEvent(b.id, 'signup');

        const idA = clientId();
        await storeGaClientIdFirstTouch(a.id, idA);
        await replayPendingActivationEventsToGa4(a.id);

        expect(sentEvents()).toEqual(['sign_up']);
        expect(sentClientIds()).toEqual([idA]);
        expect(await readStamp(a.id, 'signup')).toBeInstanceOf(Date);
        expect(await readStamp(b.id, 'signup')).toBeNull();
    });
});
