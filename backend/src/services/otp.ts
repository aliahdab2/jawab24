import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../db';
import { otpCodes } from '../db/schema';
import { eq, and, gt, lt } from 'drizzle-orm';
import { captureError } from '../utils/sentryHelpers';

const BCRYPT_ROUNDS = 10;
const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RATE_LIMIT_SECONDS = 60; // min seconds between requests per phone

export type OtpVerifyResult = 'valid' | 'invalid' | 'expired' | 'exceeded';

export class OtpService {
    generateCode(): string {
        // Cryptographically random 6-digit code
        const min = 100000;
        const max = 999999;
        const range = max - min + 1;
        const bytesNeeded = Math.ceil(Math.log2(range) / 8);
        const maxValid = Math.floor(256 ** bytesNeeded / range) * range;

        let value: number;
        do {
            const buf = Buffer.allocUnsafe(bytesNeeded);
            crypto.randomFillSync(buf);
            value = buf.readUIntBE(0, bytesNeeded);
        } while (value >= maxValid);

        return String(min + (value % range));
    }

    async storeOtp(phone: string, code: string): Promise<void> {
        // Rate limit: reject if an OTP was already sent within the last 60 seconds
        const recentCutoff = new Date(Date.now() - OTP_RATE_LIMIT_SECONDS * 1000);
        const recent = await db
            .select({ id: otpCodes.id })
            .from(otpCodes)
            .where(and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, recentCutoff)))
            .limit(1);

        if (recent.length > 0) {
            throw new OtpRateLimitError();
        }

        // Delete any existing OTPs for this phone (clean slate)
        await db.delete(otpCodes).where(eq(otpCodes.phone, phone));

        const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

        await db.insert(otpCodes).values({ phone, codeHash, expiresAt });
    }

    // A pre-hashed dummy used when no OTP record exists, so the bcrypt
    // comparison still runs and response time is indistinguishable from a
    // real miss — prevents timing-based enumeration of pending OTPs.
    private static readonly DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

    async verifyOtp(phone: string, code: string): Promise<OtpVerifyResult> {
        const now = new Date();

        const rows = await db
            .select()
            .from(otpCodes)
            .where(eq(otpCodes.phone, phone))
            .limit(1);

        if (rows.length === 0) {
            // Run bcrypt anyway so response time doesn't reveal whether a
            // pending OTP exists for this phone.
            await bcrypt.compare(code, OtpService.DUMMY_HASH);
            return 'expired';
        }

        const otp = rows[0];

        if (otp.expiresAt < now) {
            await db.delete(otpCodes).where(eq(otpCodes.phone, phone));
            return 'expired';
        }

        if (otp.attempts >= OTP_MAX_ATTEMPTS) {
            return 'exceeded';
        }

        // Increment attempts before checking — prevents timing attacks
        await db
            .update(otpCodes)
            .set({ attempts: otp.attempts + 1 })
            .where(eq(otpCodes.phone, phone));

        const match = await bcrypt.compare(code, otp.codeHash);

        if (!match) {
            return 'invalid';
        }

        // Valid — delete the OTP so it can't be reused
        await db.delete(otpCodes).where(eq(otpCodes.phone, phone));
        return 'valid';
    }

    /**
     * Can any channel carry a verification code right now?
     *
     * ❌ Nothing can (D-123) — see `sendOtp`. It exists as a predicate so the
     * caller can refuse BEFORE minting: `storeOtp` writes an `otp_codes` row and
     * consumes the per-phone rate-limit slot, and doing that for a code nobody
     * can receive is both a pointless write and a way to lock a user out of a
     * feature that never worked. `sendOtp` still throws — this is the polite
     * gate, that is the guarantee.
     */
    hasTransport(): boolean {
        return false;
    }

    /**
     * Deliver a code to a phone — ❌ NO TRANSPORT EXISTS TODAY.
     *
     * The SMS rail was retired with the Vonage provider (D-123), and WhatsApp
     * cannot replace it here: a verification code goes to someone who has
     * connected nothing yet, so it must be sent from a Jawab24-owned WhatsApp
     * Business Account, and there is none (every WhatsApp send in this codebase
     * uses a merchant's own number). Meta also requires an AUTHENTICATION-category
     * template, while `whatsappService.createMessageTemplate` submits UTILITY only.
     *
     * This throws rather than returning quietly, because a silent success here
     * would let the caller answer «code sent» to a user who will never receive
     * one — exactly the failure the retired rail used to produce.
     *
     * ⚠️ The rest of this service (generate / store / verify, `otp_codes`) is
     * transport-agnostic and deliberately kept: it is what a WhatsApp OTP would
     * reuse. The prerequisites for that are in `.planning/WHATSAPP_PLAN.md`.
     * Callers reach here only when `PHONE_AUTH_ENABLED` is on, which it is not.
     */
    async sendOtp(phone: string, _code: string, _locale?: string): Promise<void> {
        throw new OtpTransportUnavailableError(phone);
    }

    async cleanupExpired(): Promise<void> {
        try {
            await db.delete(otpCodes).where(lt(otpCodes.expiresAt, new Date()));
        } catch (err) {
            captureError(err, 'otp.cleanupExpired');
        }
    }
}

export class OtpRateLimitError extends Error {
    constructor() {
        super('OTP rate limit: please wait before requesting a new code');
        this.name = 'OtpRateLimitError';
    }
}

/**
 * No channel can carry a verification code to this phone. Distinct from a
 * sanctions block (which is about the destination): this says the PLATFORM has
 * no verification transport at all — see `OtpService.sendOtp`.
 */
export class OtpTransportUnavailableError extends Error {
    constructor(phone: string) {
        super(`No verification transport is configured (cannot deliver a code to ${phone})`);
        this.name = 'OtpTransportUnavailableError';
    }
}

export const otpService = new OtpService();
