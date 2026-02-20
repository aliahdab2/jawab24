import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../../src/lib/circuitBreaker';

vi.mock('@sentry/node', () => ({
    captureMessage: vi.fn(),
}));

import * as Sentry from '@sentry/node';

/** Build a minimal Redis mock with all methods used by CircuitBreaker */
function makeRedis() {
    return {
        exists: vi.fn().mockResolvedValue(0),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
    };
}

describe('CircuitBreaker', () => {
    let mockRedis: ReturnType<typeof makeRedis>;
    let cb: CircuitBreaker;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRedis = makeRedis();
        cb = new CircuitBreaker(mockRedis as any, 'test', {
            failureThreshold: 3,
            openDurationSeconds: 10,
            probeLockTtlSeconds: 5,
            inactivityResetSeconds: 60,
        });
    });

    // ------------------------------------------------------------------ //
    // getState
    // ------------------------------------------------------------------ //
    describe('getState', () => {
        it('returns closed when no failures and no open key', async () => {
            mockRedis.exists.mockResolvedValue(0);
            mockRedis.get.mockResolvedValue(null);

            expect(await cb.getState()).toBe('closed');
        });

        it('returns open when circuit open key exists', async () => {
            mockRedis.exists.mockResolvedValue(1);

            expect(await cb.getState()).toBe('open');
            // get() should NOT be called — open check short-circuits
            expect(mockRedis.get).not.toHaveBeenCalled();
        });

        it('returns half-open when failures >= threshold but open key is absent', async () => {
            mockRedis.exists.mockResolvedValue(0);
            mockRedis.get.mockResolvedValue('3');

            expect(await cb.getState()).toBe('half-open');
        });

        it('returns closed when failures < threshold', async () => {
            mockRedis.exists.mockResolvedValue(0);
            mockRedis.get.mockResolvedValue('2');

            expect(await cb.getState()).toBe('closed');
        });
    });

    // ------------------------------------------------------------------ //
    // execute — closed state
    // ------------------------------------------------------------------ //
    describe('execute (closed state)', () => {
        beforeEach(() => {
            mockRedis.exists.mockResolvedValue(0);
            mockRedis.get.mockResolvedValue('0');
        });

        it('calls fn and returns its result', async () => {
            const fn = vi.fn().mockResolvedValue('result');

            const result = await cb.execute(fn);

            expect(fn).toHaveBeenCalledOnce();
            expect(result).toBe('result');
        });

        it('deletes all state keys on success', async () => {
            await cb.execute(vi.fn().mockResolvedValue('ok'));

            expect(mockRedis.del).toHaveBeenCalledWith(
                'cb:test:failures',
                'cb:test:open',
                'cb:test:probe_lock',
            );
        });

        it('increments failure counter when fn throws', async () => {
            mockRedis.incr.mockResolvedValue(1);
            const fn = vi.fn().mockRejectedValue(new Error('boom'));

            await expect(cb.execute(fn)).rejects.toThrow('boom');

            expect(mockRedis.incr).toHaveBeenCalledWith('cb:test:failures');
        });

        it('sets inactivity TTL on the first failure', async () => {
            mockRedis.incr.mockResolvedValue(1);

            await expect(cb.execute(vi.fn().mockRejectedValue(new Error('x')))).rejects.toThrow();

            expect(mockRedis.expire).toHaveBeenCalledWith('cb:test:failures', 60);
        });

        it('does NOT refresh TTL on subsequent failures', async () => {
            mockRedis.incr.mockResolvedValue(2);

            await expect(cb.execute(vi.fn().mockRejectedValue(new Error('x')))).rejects.toThrow();

            expect(mockRedis.expire).not.toHaveBeenCalled();
        });

        it('opens the circuit when failure count reaches threshold', async () => {
            mockRedis.incr.mockResolvedValue(3); // equals failureThreshold

            await expect(cb.execute(vi.fn().mockRejectedValue(new Error('x')))).rejects.toThrow();

            expect(mockRedis.set).toHaveBeenCalledWith('cb:test:open', '1', 'EX', 10);
        });

        it('does NOT open the circuit while failures are below threshold', async () => {
            mockRedis.incr.mockResolvedValue(2);

            await expect(cb.execute(vi.fn().mockRejectedValue(new Error('x')))).rejects.toThrow();

            // set should NOT have been called with the open key
            const setCalls = mockRedis.set.mock.calls;
            const openCall = setCalls.find((args: unknown[]) => args[0] === 'cb:test:open');
            expect(openCall).toBeUndefined();
        });

        it('captures Sentry warning when circuit first opens (closed → open)', async () => {
            mockRedis.incr.mockResolvedValue(3); // reaches threshold

            await expect(cb.execute(vi.fn().mockRejectedValue(new Error('x')))).rejects.toThrow();

            expect(Sentry.captureMessage).toHaveBeenCalledWith(
                "Circuit breaker 'test' opened",
                expect.objectContaining({ level: 'warning', tags: { circuit: 'test' } }),
            );
        });

        it('does NOT capture Sentry when failures are below threshold', async () => {
            mockRedis.incr.mockResolvedValue(2); // below threshold

            await expect(cb.execute(vi.fn().mockRejectedValue(new Error('x')))).rejects.toThrow();

            expect(Sentry.captureMessage).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------ //
    // execute — open state
    // ------------------------------------------------------------------ //
    describe('execute (open state)', () => {
        beforeEach(() => {
            mockRedis.exists.mockResolvedValue(1); // circuit open key present
        });

        it('throws CircuitOpenError without calling fn', async () => {
            const fn = vi.fn();

            await expect(cb.execute(fn)).rejects.toThrow(CircuitOpenError);

            expect(fn).not.toHaveBeenCalled();
        });

        it('does not touch failure counter or probe lock', async () => {
            await expect(cb.execute(vi.fn())).rejects.toThrow(CircuitOpenError);

            expect(mockRedis.incr).not.toHaveBeenCalled();
            expect(mockRedis.del).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------ //
    // execute — half-open state
    // ------------------------------------------------------------------ //
    describe('execute (half-open state)', () => {
        beforeEach(() => {
            // Open key gone (expired), but failure count still at threshold
            mockRedis.exists.mockResolvedValue(0);
            mockRedis.get.mockResolvedValue('3');
        });

        it('allows one probe when the lock is acquired', async () => {
            mockRedis.set.mockResolvedValue('OK'); // NX succeeds
            const fn = vi.fn().mockResolvedValue('probe result');

            const result = await cb.execute(fn);

            expect(fn).toHaveBeenCalledOnce();
            expect(result).toBe('probe result');
        });

        it('throws CircuitOpenError when probe lock is already held', async () => {
            mockRedis.set.mockResolvedValue(null); // NX fails — lock taken
            const fn = vi.fn();

            await expect(cb.execute(fn)).rejects.toThrow(CircuitOpenError);

            expect(fn).not.toHaveBeenCalled();
        });

        it('resets all state on successful probe', async () => {
            mockRedis.set.mockResolvedValue('OK');

            await cb.execute(vi.fn().mockResolvedValue('ok'));

            expect(mockRedis.del).toHaveBeenCalledWith(
                'cb:test:failures',
                'cb:test:open',
                'cb:test:probe_lock',
            );
        });

        it('re-opens circuit and releases probe lock on failed probe', async () => {
            // First set call = probe lock (NX), second = circuit open key
            mockRedis.set.mockResolvedValueOnce('OK'); // probe lock acquired
            mockRedis.incr.mockResolvedValue(4);       // above threshold

            await expect(
                cb.execute(vi.fn().mockRejectedValue(new Error('probe fail'))),
            ).rejects.toThrow('probe fail');

            // Circuit should be re-opened
            expect(mockRedis.set).toHaveBeenCalledWith('cb:test:open', '1', 'EX', 10);
            // Probe lock should be released
            expect(mockRedis.del).toHaveBeenCalledWith('cb:test:probe_lock');
        });

        it('does NOT capture Sentry when re-opening from half-open (not a first-open)', async () => {
            mockRedis.set.mockResolvedValueOnce('OK'); // probe lock acquired
            mockRedis.incr.mockResolvedValue(4);       // above threshold

            await expect(
                cb.execute(vi.fn().mockRejectedValue(new Error('probe fail'))),
            ).rejects.toThrow('probe fail');

            // Sentry should NOT fire — this is a re-open from half-open, not first open
            expect(Sentry.captureMessage).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------ //
    // reset
    // ------------------------------------------------------------------ //
    describe('reset', () => {
        it('deletes all circuit breaker keys', async () => {
            await cb.reset();

            expect(mockRedis.del).toHaveBeenCalledWith(
                'cb:test:failures',
                'cb:test:open',
                'cb:test:probe_lock',
            );
        });
    });
});
