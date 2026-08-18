/**
 * Tests: the GA4 mirror on the activation funnel (services/activation.ts).
 *
 * The claim under test is IDEMPOTENCY, and it is load-bearing for money: Google
 * Ads imports these as conversions, so a milestone that mirrors twice inflates
 * the conversion count and teaches Smart Bidding from a lie. `first_autoreply_sent`
 * is re-emitted on EVERY successful reply, so the duplicate path is not
 * hypothetical — it is the common case.
 *
 * The guarantee comes from `INSERT … ON CONFLICT DO NOTHING RETURNING id`:
 * Postgres returns a row only when the insert actually happened. These tests pin
 * that the mirror is driven by the RETURNING result, not by the call.
 *
 * Verifies:
 *   - a genuine first insert mirrors exactly once
 *   - a conflicting re-emit mirrors NOT AT ALL
 *   - 'signup' is renamed to GA4's recommended 'sign_up'; other milestones pass
 *     through verbatim
 *   - a failing mirror never escapes into the caller's request path
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insertReturningQueue, insertValues, sendGa4EventForUserMock, captureErrorMock } = vi.hoisted(() => ({
    /** One entry per INSERT that calls .returning(); shifted in call order. */
    insertReturningQueue: { value: [] as unknown[][] },
    /** Every .values() payload, in call order. */
    insertValues: { value: [] as Record<string, unknown>[] },
    sendGa4EventForUserMock: vi.fn(),
    captureErrorMock: vi.fn(),
}));

vi.mock('../db', () => {
    const makeInsert = () => {
        const chain: Record<string, unknown> = {};
        chain.values = vi.fn((v: Record<string, unknown>) => { insertValues.value.push(v); return chain; });
        chain.onConflictDoNothing = vi.fn(() => chain);
        chain.returning = vi.fn(() => Promise.resolve(insertReturningQueue.value.shift() ?? []));
        return chain;
    };
    return { db: { insert: vi.fn(() => makeInsert()) } };
});

vi.mock('../db/schema', () => ({
    activationEvents: { id: 'activation_events.id' },
    pages: {},
}));
vi.mock('../services/ga4', () => ({ sendGa4EventForUser: sendGa4EventForUserMock }));
vi.mock('../services/workspaceSettings', () => ({ workspaceSettingsService: { getSettings: vi.fn() } }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: captureErrorMock }));

import { recordActivationEvent } from '../services/activation';

/** A non-empty RETURNING result — Postgres's signal that the row was inserted. */
const INSERTED = [{ id: 'evt-1' }];
/** An empty RETURNING result — the ON CONFLICT DO NOTHING path. */
const CONFLICTED: unknown[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    insertReturningQueue.value = [];
    insertValues.value = [];
    sendGa4EventForUserMock.mockResolvedValue({ sent: true });
});

describe('activation → GA4 mirror', () => {
    it('mirrors exactly once on a genuine first insert', async () => {
        insertReturningQueue.value = [INSERTED];

        await recordActivationEvent('user-1', 'page_connected');

        expect(sendGa4EventForUserMock).toHaveBeenCalledTimes(1);
        expect(sendGa4EventForUserMock).toHaveBeenCalledWith('user-1', 'page_connected');
    });

    it('does NOT mirror when the row already existed', async () => {
        insertReturningQueue.value = [CONFLICTED];

        await recordActivationEvent('user-1', 'first_autoreply_sent');

        expect(sendGa4EventForUserMock).not.toHaveBeenCalled();
    });

    it('mirrors once across a first emit followed by many re-emits', async () => {
        // The real hot path: one activating reply, then every later reply.
        insertReturningQueue.value = [INSERTED, CONFLICTED, CONFLICTED, CONFLICTED];

        for (let i = 0; i < 4; i++) {
            await recordActivationEvent('user-1', 'first_autoreply_sent');
        }

        expect(sendGa4EventForUserMock).toHaveBeenCalledTimes(1);
        // The row is still written on every call — only the mirror is suppressed.
        expect(insertValues.value).toHaveLength(4);
    });

    it("renames 'signup' to GA4's recommended 'sign_up'", async () => {
        insertReturningQueue.value = [INSERTED];

        await recordActivationEvent('user-1', 'signup', { method: 'facebook' });

        expect(sendGa4EventForUserMock).toHaveBeenCalledWith('user-1', 'sign_up');
    });

    it('passes the other milestones through verbatim', async () => {
        const passthrough = [
            'page_connected', 'kb_filled', 'autoreply_enabled',
            'first_autoreply_sent', 'no_fb_pages', 'ig_direct_interest',
        ] as const;
        insertReturningQueue.value = passthrough.map(() => INSERTED);

        for (const event of passthrough) {
            await recordActivationEvent('user-1', event);
        }

        expect(sendGa4EventForUserMock.mock.calls.map(c => c[1])).toEqual([...passthrough]);
    });

    // The mirror is dispatched with `void`, so a rejection that escapes it is an
    // UNHANDLED REJECTION, not a caught error — it would never fail the caller's
    // request but can take the process down depending on the Node flags. Assert
    // the rejection is contained AND reported, not merely that the caller survived.
    it('never lets a failing mirror escape as an unhandled rejection', async () => {
        insertReturningQueue.value = [INSERTED];
        sendGa4EventForUserMock.mockRejectedValue(new Error('GA4 exploded'));
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
});
