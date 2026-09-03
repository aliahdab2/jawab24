import { describe, it, expect, vi, beforeEach } from 'vitest';

// DB must be mocked before the service is imported
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('bcrypt', () => ({
    default: {
        hash: vi.fn().mockResolvedValue('$2b$10$hashedcode'),
        compare: vi.fn().mockResolvedValue(false),
    },
}));

import { OtpService, OtpRateLimitError, OtpTransportUnavailableError } from '../../src/services/otp';
import { db } from '../../src/db';
import bcrypt from 'bcrypt';

// ─── Helper: build a chainable query mock ────────────────────────────────────

function makeSelectChain(result: unknown[]) {
    const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(result),
    };
    vi.mocked(db.select).mockReturnValue(chain as any);
    return chain;
}

function makeDeleteChain(result: unknown[] = []) {
    const chain = {
        where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(result),
        }),
    };
    vi.mocked(db.delete).mockReturnValue(chain as any);
    return chain;
}

function makeInsertChain() {
    const chain = {
        values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'otp-1' }]),
        }),
    };
    vi.mocked(db.insert).mockReturnValue(chain as any);
    return chain;
}

function makeUpdateChain() {
    const chain = {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
        }),
    };
    vi.mocked(db.update).mockReturnValue(chain as any);
    return chain;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OtpService', () => {
    let service: OtpService;

    beforeEach(() => {
        service = new OtpService();
        vi.clearAllMocks();
    });

    // ── generateCode ──────────────────────────────────────────────────────────

    describe('generateCode', () => {
        it('returns a 6-digit string', () => {
            const code = service.generateCode();
            expect(code).toMatch(/^\d{6}$/);
        });

        it('returns values in range 100000–999999', () => {
            for (let i = 0; i < 20; i++) {
                const n = parseInt(service.generateCode(), 10);
                expect(n).toBeGreaterThanOrEqual(100000);
                expect(n).toBeLessThanOrEqual(999999);
            }
        });

        it('produces different codes across calls (not constant)', () => {
            const codes = new Set(Array.from({ length: 10 }, () => service.generateCode()));
            expect(codes.size).toBeGreaterThan(1);
        });
    });

    // ── storeOtp ──────────────────────────────────────────────────────────────

    describe('storeOtp', () => {
        it('stores hashed OTP when no recent OTP exists', async () => {
            // rate-limit check: no recent rows
            makeSelectChain([]);
            makeDeleteChain();
            makeInsertChain();

            await service.storeOtp('+966500000001', '123456');

            expect(db.insert).toHaveBeenCalled();
            expect(bcrypt.hash).toHaveBeenCalledWith('123456', 10);
        });

        it('throws OtpRateLimitError when a recent OTP exists', async () => {
            makeSelectChain([{ id: 'existing-otp' }]);

            await expect(service.storeOtp('+966500000001', '123456')).rejects.toThrow(
                OtpRateLimitError,
            );
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('deletes existing OTPs before inserting new one', async () => {
            makeSelectChain([]);
            const deleteChain = makeDeleteChain();
            makeInsertChain();

            await service.storeOtp('+966500000001', '123456');

            expect(deleteChain.where).toHaveBeenCalled();
            expect(db.insert).toHaveBeenCalled();
        });
    });

    // ── verifyOtp ─────────────────────────────────────────────────────────────

    describe('verifyOtp', () => {
        const futureDate = new Date(Date.now() + 5 * 60 * 1000);
        const pastDate = new Date(Date.now() - 1000);

        it('returns "expired" when no OTP record exists', async () => {
            makeSelectChain([]);

            const result = await service.verifyOtp('+966500000001', '123456');

            expect(result).toBe('expired');
        });

        it('runs bcrypt compare even when no record exists (timing attack mitigation)', async () => {
            makeSelectChain([]);

            await service.verifyOtp('+966500000001', '123456');

            expect(bcrypt.compare).toHaveBeenCalledOnce();
        });

        it('returns "expired" and cleans up when OTP is past expiry', async () => {
            makeSelectChain([
                { id: 'otp-1', codeHash: 'hash', expiresAt: pastDate, attempts: 0 },
            ]);
            makeDeleteChain();

            const result = await service.verifyOtp('+966500000001', '123456');

            expect(result).toBe('expired');
            expect(db.delete).toHaveBeenCalled();
        });

        it('returns "exceeded" when attempts >= 3', async () => {
            makeSelectChain([
                { id: 'otp-1', codeHash: 'hash', expiresAt: futureDate, attempts: 3 },
            ]);

            const result = await service.verifyOtp('+966500000001', '123456');

            expect(result).toBe('exceeded');
            expect(db.update).not.toHaveBeenCalled();
        });

        it('returns "invalid" and increments attempts on wrong code', async () => {
            makeSelectChain([
                { id: 'otp-1', codeHash: 'hash', expiresAt: futureDate, attempts: 0 },
            ]);
            makeUpdateChain();
            vi.mocked(bcrypt.compare).mockResolvedValueOnce(false);

            const result = await service.verifyOtp('+966500000001', '999999');

            expect(result).toBe('invalid');
            expect(db.update).toHaveBeenCalled();
        });

        it('returns "valid" and deletes OTP on correct code', async () => {
            makeSelectChain([
                { id: 'otp-1', codeHash: 'hash', expiresAt: futureDate, attempts: 0 },
            ]);
            makeUpdateChain();
            makeDeleteChain();
            vi.mocked(bcrypt.compare).mockResolvedValueOnce(true);

            const result = await service.verifyOtp('+966500000001', '123456');

            expect(result).toBe('valid');
            expect(db.delete).toHaveBeenCalled();
        });

        it('increments attempts before bcrypt compare (prevents early exit)', async () => {
            const callOrder: string[] = [];
            makeSelectChain([
                { id: 'otp-1', codeHash: 'hash', expiresAt: futureDate, attempts: 0 },
            ]);
            const updateChain = makeUpdateChain();
            updateChain.set.mockImplementation(() => {
                callOrder.push('update');
                return { where: vi.fn().mockResolvedValue([]) };
            });
            vi.mocked(bcrypt.compare).mockImplementation(async () => {
                callOrder.push('bcrypt');
                return false;
            });

            await service.verifyOtp('+966500000001', '000000');

            expect(callOrder).toEqual(['update', 'bcrypt']);
        });
    });

    // ── sendOtp ───────────────────────────────────────────────────────────────

    /**
     * There is NO verification transport (D-123): the SMS rail retired with the
     * Vonage provider, and WhatsApp OTP needs a Jawab24-owned WABA plus an
     * AUTHENTICATION-category template, neither of which exists.
     *
     * What these cases pin is that the absence is LOUD. A `sendOtp` that
     * resolved quietly would let the controller answer «code sent» to someone
     * who will never receive one — the exact failure shape the dead SMS rail
     * used to produce, and the reason it was removed rather than left in place.
     */
    // The controller gates on this BEFORE minting, and it does so against a
    // MOCK — so nothing outside this case can catch the production value being
    // wrong. If a transport is ever added, this test is the one that must be
    // changed deliberately, alongside `sendOtp`.
    describe('hasTransport', () => {
        it('reports that no transport exists', () => {
            expect(service.hasTransport()).toBe(false);
        });

        it('agrees with sendOtp — a false report and a throwing send are one fact', async () => {
            expect(service.hasTransport()).toBe(false);
            await expect(service.sendOtp('+966500000001', '123456'))
                .rejects.toBeInstanceOf(OtpTransportUnavailableError);
        });
    });

    describe('sendOtp', () => {
        it('throws instead of pretending a code was delivered', async () => {
            await expect(service.sendOtp('+966500000001', '123456'))
                .rejects.toBeInstanceOf(OtpTransportUnavailableError);
        });

        it('throws for every locale — no transport is locale-specific', async () => {
            await expect(service.sendOtp('+966500000001', '123456', 'ar')).rejects.toThrow();
            await expect(service.sendOtp('+966500000001', '123456', 'en')).rejects.toThrow();
        });

        it('names the destination in the error, and never the code', async () => {
            const error = await service.sendOtp('+966500000001', '123456').catch((e: Error) => e);

            expect((error as Error).message).toContain('+966500000001');
            // A verification code must not reach logs or Sentry through an
            // error message — this is the one place it could have leaked.
            expect((error as Error).message).not.toContain('123456');
        });
    });

    // ── cleanupExpired ────────────────────────────────────────────────────────

    describe('cleanupExpired', () => {
        it('deletes expired OTP records', async () => {
            const deleteChain = makeDeleteChain([{ id: 'old-1' }]);

            await service.cleanupExpired();

            expect(deleteChain.where).toHaveBeenCalled();
        });

        it('does not throw on DB error', async () => {
            vi.mocked(db.delete).mockReturnValue({
                where: vi.fn().mockRejectedValue(new Error('DB down')),
            } as any);

            await expect(service.cleanupExpired()).resolves.toBeUndefined();
        });
    });
});
