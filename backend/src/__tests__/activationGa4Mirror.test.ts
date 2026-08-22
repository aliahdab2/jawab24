/**
 * Tests: the GA4 mirror on the activation funnel (services/activation.ts).
 *
 * The claim under test is EXACTLY-ONCE, and it is load-bearing for money: Google
 * Ads imports these as conversions, so a milestone that mirrors twice inflates
 * the conversion count and teaches Smart Bidding from a lie, while one that never
 * mirrors leaves the signup conversion Ads bids on permanently empty — which is
 * what production did until 2026-08-22.
 *
 * Two mechanisms, pinned separately:
 *   - `INSERT … ON CONFLICT DO NOTHING RETURNING id` decides whether a mirror is
 *     ATTEMPTED at all: Postgres returns a row only when the insert happened, so
 *     a re-emit (the hot `first_autoreply_sent` path) never touches GA4.
 *   - `UPDATE activation_events … FROM users WHERE ga_client_id IS NOT NULL AND
 *     ga4_mirrored_at IS NULL RETURNING` decides whether a NEW row is SENT: it
 *     claims the row and hands back the attribution id in one statement. No id
 *     yet ⇒ nothing claimed, the row stays pending for the signup-session
 *     replay. That replay goes through the same claim.
 *
 * Verifies:
 *   - a genuine first insert claims, then sends with the claimed client id
 *   - a first insert whose claim returns nothing (no client id yet) sends nothing
 *   - a conflicting re-emit neither claims nor sends
 *   - an unconfigured GA4 never claims (a burned claim here is a lost event)
 *   - 'signup' is renamed to GA4's recommended 'sign_up'; other milestones pass
 *     through verbatim
 *   - the replay sends every claimed row oldest-first, and nothing when the
 *     claim returns nothing
 *   - neither the mirror nor the replay lets a failure escape into the caller
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    insertReturningQueue, insertValues, claimQueue, updateSpy,
    sendGa4EventMock, captureErrorMock, ga4Configured,
} = vi.hoisted(() => ({
    /** One entry per INSERT that calls .returning(); shifted in call order. */
    insertReturningQueue: { value: [] as unknown[][] },
    /** Every .values() payload, in call order. */
    insertValues: { value: [] as Record<string, unknown>[] },
    /**
     * One entry per claim UPDATE, shifted in call order. Rows mean the claim was
     * won (each carries the client id the JOIN returned); `[]` means nothing was
     * claimable — no client id yet, or already stamped. An `Error` is thrown,
     * standing in for a database failure.
     */
    claimQueue: { value: [] as (unknown[] | Error)[] },
    /** Records every claim attempt, so a test can assert none was MADE. */
    updateSpy: vi.fn(),
    sendGa4EventMock: vi.fn(),
    captureErrorMock: vi.fn(),
    ga4Configured: { value: true },
}));

vi.mock('../db', () => {
    const makeInsert = () => {
        const chain: Record<string, unknown> = {};
        chain.values = vi.fn((v: Record<string, unknown>) => { insertValues.value.push(v); return chain; });
        chain.onConflictDoNothing = vi.fn(() => chain);
        chain.returning = vi.fn(() => Promise.resolve(insertReturningQueue.value.shift() ?? []));
        return chain;
    };
    const makeUpdate = () => {
        const next = claimQueue.value.shift() ?? [];
        const chain: Record<string, unknown> = {};
        chain.set = vi.fn(() => chain);
        chain.from = vi.fn(() => chain);
        chain.where = vi.fn(() => chain);
        chain.returning = vi.fn(() =>
            next instanceof Error ? Promise.reject(next) : Promise.resolve(next));
        return chain;
    };
    return {
        db: {
            insert: vi.fn(() => makeInsert()),
            update: vi.fn((...args: unknown[]) => { updateSpy(...args); return makeUpdate(); }),
        },
    };
});

// String stand-ins: the real drizzle operators accept non-Column operands as
// parameters, which is all the claim's WHERE needs to build without a schema.
vi.mock('../db/schema', () => ({
    activationEvents: {
        id: 'activation_events.id',
        userId: 'activation_events.user_id',
        event: 'activation_events.event',
        createdAt: 'activation_events.created_at',
        ga4MirroredAt: 'activation_events.ga4_mirrored_at',
    },
    users: { id: 'users.id', gaClientId: 'users.ga_client_id' },
    pages: {},
}));
vi.mock('../services/ga4', () => ({
    sendGa4Event: sendGa4EventMock,
    isGa4Configured: () => ga4Configured.value,
}));
vi.mock('../services/workspaceSettings', () => ({ workspaceSettingsService: { getSettings: vi.fn() } }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: captureErrorMock }));

import { recordActivationEvent, replayPendingActivationEventsToGa4 } from '../services/activation';

/** A non-empty RETURNING result — Postgres's signal that the row was inserted. */
const INSERTED = [{ id: 'evt-1' }];
/** An empty RETURNING result — the ON CONFLICT DO NOTHING path. */
const CONFLICTED: unknown[] = [];

const T0 = new Date('2026-08-22T10:00:00Z');
/** A won claim for the inserted row, carrying the JOIN-returned client id. */
const claimed = (event: string, createdAt = T0, id = 'evt-1') =>
    [{ id, event, clientId: '1234567890.1700000000', createdAt }];
/** Nothing claimable: no client id stored yet, or the row is already stamped. */
const UNCLAIMED: unknown[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    insertReturningQueue.value = [];
    insertValues.value = [];
    claimQueue.value = [];
    ga4Configured.value = true;
    sendGa4EventMock.mockResolvedValue({ sent: true });
});

describe('activation → GA4 mirror', () => {
    it('claims, then sends with the claimed client id, on a genuine first insert', async () => {
        insertReturningQueue.value = [INSERTED];
        claimQueue.value = [claimed('page_connected')];

        await recordActivationEvent('user-1', 'page_connected');

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(sendGa4EventMock).toHaveBeenCalledTimes(1);
        expect(sendGa4EventMock).toHaveBeenCalledWith('1234567890.1700000000', 'page_connected');
    });

    it('sends nothing when the claim returns no row — the client id is not stored yet', async () => {
        // The `sign_up` case in production: the row is inserted inside the auth
        // request, before the browser has posted the id. It must stay pending.
        insertReturningQueue.value = [INSERTED];
        claimQueue.value = [UNCLAIMED];

        await recordActivationEvent('user-1', 'signup');

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(sendGa4EventMock).not.toHaveBeenCalled();
    });

    it('neither claims nor sends when the row already existed', async () => {
        insertReturningQueue.value = [CONFLICTED];

        await recordActivationEvent('user-1', 'first_autoreply_sent');

        expect(updateSpy).not.toHaveBeenCalled();
        expect(sendGa4EventMock).not.toHaveBeenCalled();
    });

    it('mirrors once across a first emit followed by many re-emits', async () => {
        // The real hot path: one activating reply, then every later reply.
        insertReturningQueue.value = [INSERTED, CONFLICTED, CONFLICTED, CONFLICTED];
        claimQueue.value = [claimed('first_autoreply_sent')];

        for (let i = 0; i < 4; i++) {
            await recordActivationEvent('user-1', 'first_autoreply_sent');
        }

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(sendGa4EventMock).toHaveBeenCalledTimes(1);
        // The row is still written on every call — only the mirror is suppressed.
        expect(insertValues.value).toHaveLength(4);
    });

    it('does not claim when GA4 is not configured — a stamped-but-unsent row would be lost', async () => {
        ga4Configured.value = false;
        insertReturningQueue.value = [INSERTED];
        claimQueue.value = [claimed('page_connected')];

        await recordActivationEvent('user-1', 'page_connected');

        expect(insertValues.value).toHaveLength(1);
        expect(updateSpy).not.toHaveBeenCalled();
        expect(sendGa4EventMock).not.toHaveBeenCalled();
    });

    it("renames 'signup' to GA4's recommended 'sign_up'", async () => {
        insertReturningQueue.value = [INSERTED];
        claimQueue.value = [claimed('signup')];

        await recordActivationEvent('user-1', 'signup', { method: 'facebook' });

        expect(sendGa4EventMock).toHaveBeenCalledWith('1234567890.1700000000', 'sign_up');
    });

    it('passes the other milestones through verbatim', async () => {
        const passthrough = [
            'page_connected', 'kb_filled', 'autoreply_enabled',
            'first_autoreply_sent', 'no_fb_pages', 'ig_direct_interest',
        ] as const;
        insertReturningQueue.value = passthrough.map(() => INSERTED);
        claimQueue.value = passthrough.map(event => claimed(event));

        for (const event of passthrough) {
            await recordActivationEvent('user-1', event);
        }

        expect(sendGa4EventMock.mock.calls.map(c => c[1])).toEqual([...passthrough]);
    });

    // A rejection that escaped the mirror would surface as an UNHANDLED
    // REJECTION at the production call sites (which `void` the record call) —
    // never failing the request but able to take the process down depending on
    // the Node flags. Assert it is contained AND reported.
    it('never lets a failing send escape as an unhandled rejection', async () => {
        insertReturningQueue.value = [INSERTED];
        claimQueue.value = [claimed('signup')];
        sendGa4EventMock.mockRejectedValue(new Error('GA4 exploded'));
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);

        try {
            await expect(recordActivationEvent('user-1', 'signup')).resolves.toBeUndefined();
            // Let the microtask queue drain so an escaped rejection would surface.
            await new Promise(resolve => setImmediate(resolve));

            expect(unhandled).not.toHaveBeenCalled();
            expect(captureErrorMock).toHaveBeenCalledTimes(1);
            expect(captureErrorMock.mock.calls[0][2]).toMatchObject({ level: 'warning' });
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('contains a failing claim the same way', async () => {
        insertReturningQueue.value = [INSERTED];
        claimQueue.value = [new Error('connection reset')];

        await expect(recordActivationEvent('user-1', 'signup')).resolves.toBeUndefined();

        expect(sendGa4EventMock).not.toHaveBeenCalled();
        expect(captureErrorMock).toHaveBeenCalledTimes(1);
        expect(captureErrorMock.mock.calls[0][2]).toMatchObject({ level: 'warning' });
    });
});

describe('signup-session replay → GA4', () => {
    it('sends every claimed row oldest-first, renaming signup', async () => {
        // RETURNING carries no order guarantee — hand the rows back newest-first
        // and require `sign_up` to still go out before what followed it.
        claimQueue.value = [[
            { id: 'evt-2', event: 'page_connected', clientId: '9.9', createdAt: new Date(T0.getTime() + 60_000) },
            { id: 'evt-1', event: 'signup', clientId: '9.9', createdAt: T0 },
        ]];

        await replayPendingActivationEventsToGa4('user-1');

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(sendGa4EventMock.mock.calls).toEqual([
            ['9.9', 'sign_up'],
            ['9.9', 'page_connected'],
        ]);
    });

    it('sends nothing when nothing is claimable', async () => {
        // Already mirrored live, outside the window, or a user with no rows.
        claimQueue.value = [UNCLAIMED];

        await replayPendingActivationEventsToGa4('user-1');

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(sendGa4EventMock).not.toHaveBeenCalled();
    });

    it('does not claim when GA4 is not configured', async () => {
        ga4Configured.value = false;
        claimQueue.value = [claimed('signup')];

        await replayPendingActivationEventsToGa4('user-1');

        expect(updateSpy).not.toHaveBeenCalled();
        expect(sendGa4EventMock).not.toHaveBeenCalled();
    });

    it('contains a failing claim and never rejects — the id POST must still answer 204', async () => {
        claimQueue.value = [new Error('connection reset')];
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);

        try {
            await expect(replayPendingActivationEventsToGa4('user-1')).resolves.toBeUndefined();
            await new Promise(resolve => setImmediate(resolve));

            expect(unhandled).not.toHaveBeenCalled();
            expect(sendGa4EventMock).not.toHaveBeenCalled();
            expect(captureErrorMock).toHaveBeenCalledTimes(1);
            expect(captureErrorMock.mock.calls[0][2]).toMatchObject({
                level: 'warning',
                fingerprint: ['ga4-activation-replay'],
            });
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });
});
