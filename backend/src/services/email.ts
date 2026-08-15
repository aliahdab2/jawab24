import { config } from '../config';
import type { EmailAttachment } from '@jawab24/shared';
import { captureError } from '../utils/sentryHelpers';
import { db } from '../db';
import { emailSends } from '../db/schema';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

// Email type discriminator stored on `email_sends.type`. Add new values here
// as new email kinds ship — keeps the union exhaustive at every call site.
export type EmailType = 'lead_digest' | 'waitlist' | 'transactional' | 'subscription_welcome' | 'trial_ending' | 'trial_ended' | 'invite' | 'account_notice' | 'auto_pause' | 'page_reconnect';

interface EmailPayload {
    to: string;
    subject: string;
    html: string;
    type: EmailType;
    // Optional owner of the email (recipient user). Stored on email_sends so
    // admins can filter "show me everything we sent to user X".
    userId?: string | null;
    /**
     * Carbon-copy recipients — visible to everyone on the message.
     *
     * Omitted from the Resend request entirely when absent or empty, so every
     * pre-existing caller sends the exact same payload it did before these
     * fields existed. Same for `bcc` and `attachments`: this is shared
     * infrastructure behind every email we send (digests, reminders, invites),
     * and the only safe extension is one that is provably inert when unused.
     */
    cc?: string[];
    /** Blind-copy recipients — hidden from `to` and `cc`. */
    bcc?: string[];
    /**
     * Size/count limits are the CALLER's responsibility — the composer's caps
     * live in @jawab24/shared (MAX_EMAIL_ATTACHMENT*); the transport enforces
     * only Resend's own ceiling (below). Two vendor facts every future caller
     * must know (verified against Resend's docs, 2026-08-15): an email may be
     * at most 40MB AFTER base64 encoding, and Resend's BATCH endpoint does not
     * accept attachments at all — so a broadcast with attachments can never be
     * batched and is forever a sequential per-recipient loop at the 4/sec
     * pacing above (500 recipients × 8MB ≈ ≥125s and ~4GB egress). Design any
     * broadcast-with-attachment feature with that constraint in front of you.
     */
    attachments?: EmailAttachment[];
    /**
     * Forwarded to Resend as an `Idempotency-Key` header (24h dedupe window,
     * ≤256 chars) so a caller's retry after an ambiguous failure — timeout
     * after the server received the body — cannot deliver the same email
     * twice. Omitted from the request entirely when absent.
     */
    idempotencyKey?: string;
}

// Resend rejects emails over 40MB post-base64-encoding. Refusing here, before
// the fetch, turns a guaranteed provider rejection into an immediate failed
// attempt without uploading tens of MB first. Evaluated only when attachments
// are present — provably a no-op for every attachment-less caller.
const RESEND_ATTACHMENT_CEILING_BYTES = 30 * 1024 * 1024;

interface ResendResponse {
    id: string;
}

interface ResendErrorResponse {
    statusCode: number;
    message: string;
    name: string;
}

interface SendResult {
    success: boolean;
    /** Resend's email id (when send succeeded). */
    id?: string;
    error?: string;
    /** Our email_sends row id — populated for both sent and failed attempts. */
    emailSendId?: string;
}

// Cap stored body to keep one bad email from bloating the table. 500KB
// covers a digest with hundreds of leads; anything larger is replaced with
// a marker so the audit row still exists.
const MAX_BODY_BYTES = 500_000;
function capBody(html: string): string {
    if (Buffer.byteLength(html, 'utf8') <= MAX_BODY_BYTES) return html;
    return `<!-- body omitted: exceeded ${MAX_BODY_BYTES} bytes -->`;
}

/**
 * Email Service — Resend delivery + audit log.
 *
 * Every send attempt (success OR failure) writes a row to `email_sends` so
 * admins can preview the rendered email later. Skipped sends (e.g. provider
 * not configured) DO write a failed row so the absence is visible in the
 * observability page rather than silently nothing.
 *
 * Dev mode: returns success without calling Resend AND without writing to the
 * DB — keeps local dev free of phantom audit rows.
 */
// Resend's published limit is 5 req/sec. We pace at 4/sec to leave headroom
// for retries, clock skew, and concurrent sends from other call sites
// (subscription_welcome, lead_digest, transactional) sharing the same key.
const RESEND_MAX_PER_SECOND = 4;

export class EmailService {
    private logger: Logger = noopLogger;
    setLogger(l: Logger): void { this.logger = l; }

    // Sliding window of the last N send start-times. Before each send we drop
    // entries older than 1s; if the window is full we wait until the oldest
    // expires. Serializes via `gate` so concurrent callers don't all read the
    // same window state and race past the limit.
    private sendTimestamps: number[] = [];
    private gate: Promise<void> = Promise.resolve();

    private async acquireSendSlot(): Promise<void> {
        const prev = this.gate;
        let release!: () => void;
        this.gate = new Promise<void>(resolve => { release = resolve; });
        await prev;
        try {
            const now = Date.now();
            this.sendTimestamps = this.sendTimestamps.filter(t => now - t < 1000);
            const oldest = this.sendTimestamps[0];
            if (oldest !== undefined && this.sendTimestamps.length >= RESEND_MAX_PER_SECOND) {
                const waitMs = 1000 - (now - oldest) + 5;
                await new Promise(r => setTimeout(r, waitMs));
                const after = Date.now();
                this.sendTimestamps = this.sendTimestamps.filter(t => after - t < 1000);
            }
            this.sendTimestamps.push(Date.now());
        } finally {
            release();
        }
    }

    async send(payload: EmailPayload): Promise<SendResult> {
        if (process.env.NODE_ENV === 'development') {
            this.logger.debug('Email (dev)', {
                to: payload.to,
                subject: payload.subject,
                type: payload.type,
            });
            return { success: true, id: 'dev-mode' };
        }

        if (!config.resend.apiKey) {
            this.logger.warn('Email not configured — RESEND_API_KEY is empty');
            captureError(
                new Error('Email provider not configured — RESEND_API_KEY is empty'),
                'email.send skipped — RESEND_API_KEY missing',
                { tags: { service: 'email' }, level: 'error', extra: { to: payload.to, subject: payload.subject, type: payload.type } },
            );
            const emailSendId = await this.recordAttempt(payload, { status: 'failed', errorMessage: 'Email provider not configured' });
            return { success: false, error: 'Email provider not configured', emailSendId };
        }

        // Provider-ceiling guard: a payload Resend is guaranteed to reject is
        // refused here, before uploading tens of MB. Only runs when attachments
        // are present — a no-op for every attachment-less caller.
        if (payload.attachments?.length) {
            const totalBase64Chars = payload.attachments.reduce((sum, a) => sum + a.content.length, 0);
            if (totalBase64Chars > RESEND_ATTACHMENT_CEILING_BYTES) {
                const errorMessage = `Attachments exceed the provider ceiling (${Math.round(totalBase64Chars / 1024 / 1024)}MB encoded > ${RESEND_ATTACHMENT_CEILING_BYTES / 1024 / 1024}MB)`;
                const emailSendId = await this.recordAttempt(payload, { status: 'failed', errorMessage });
                return { success: false, error: errorMessage, emailSendId };
            }
        }

        await this.acquireSendSlot();

        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.resend.apiKey}`,
                // Resend dedupes on this for 24h — a caller's retry after an
                // ambiguous failure cannot double-send. Absent → no header.
                ...(payload.idempotencyKey ? { 'Idempotency-Key': payload.idempotencyKey } : {}),
            },
            body: JSON.stringify({
                from: `${config.resend.fromName} <${config.resend.fromEmail}>`,
                to: [payload.to],
                subject: payload.subject,
                html: payload.html,
                // Spread-if-present: an absent OR empty list contributes no key,
                // so the serialized body is byte-identical to the pre-CC one for
                // every existing caller.
                //
                // Do not "simplify" to `cc: payload.cc`. JSON.stringify drops a
                // key whose value is undefined, so that shorthand looks correct
                // for callers passing nothing — but it sends `"cc":[]` for a
                // caller passing an empty array, which is a present-but-empty
                // recipient list rather than no list at all.
                ...(payload.cc?.length ? { cc: payload.cc } : {}),
                ...(payload.bcc?.length ? { bcc: payload.bcc } : {}),
                // Resend's attachment fields are snake_case; our contract stays
                // camelCase and translates only here, at the vendor boundary.
                ...(payload.attachments?.length
                    ? {
                        attachments: payload.attachments.map((a) => ({
                            filename: a.filename,
                            content: a.content,
                            ...(a.contentType ? { content_type: a.contentType } : {}),
                        })),
                    }
                    : {}),
            }),
        });

        if (!response.ok) {
            const err = await response.json() as ResendErrorResponse;
            const errorMessage = err.message || `HTTP ${response.status}`;
            captureError(
                new Error(`Resend API error: ${errorMessage}`),
                'email.send Resend API failure',
                {
                    tags: { service: 'email', statusCode: String(response.status) },
                    level: 'error',
                    extra: { to: payload.to, subject: payload.subject, type: payload.type, resendError: err },
                },
            );
            const emailSendId = await this.recordAttempt(payload, { status: 'failed', errorMessage });
            return { success: false, error: errorMessage, emailSendId };
        }

        const data = await response.json() as ResendResponse;
        const emailSendId = await this.recordAttempt(payload, { status: 'sent', resendEmailId: data.id });
        return { success: true, id: data.id, emailSendId };
    }

    /**
     * `send` as a total function: one answer to "did this actually go out?".
     *
     * ⚠️ `send` fails in TWO shapes, and they mean the same thing:
     *   - it RESOLVES `{ success: false }` for a provider-level failure (Resend
     *     4xx/5xx, unconfigured API key), and
     *   - it THROWS for a network-level one — there is no try/catch around its
     *     `fetch` above, so DNS failure, socket reset, TLS error and timeout all
     *     propagate as a raw TypeError.
     *
     * Only the first shape looks like failure, so a caller that checks
     * `result.success` alone silently treats the MORE likely outage as a
     * success. Any caller whose next step depends on delivery — releasing a
     * dedup claim, marking a row notified, counting a send — must ask this
     * instead of re-deriving the pair.
     *
     * That re-derivation is not hypothetical: both merchant-alert paths owned it
     * separately, `pageAutoPause` was corrected for it (2026-08) and the newer
     * `pageTokenRecovery` copy inherited the original bug — a 24h dedup key held
     * open by a send that never happened, i.e. the alert silenced by its own
     * failure. The knowledge lives here now, next to the function it describes.
     */
    async trySend(payload: EmailPayload): Promise<{ delivered: boolean; error?: string }> {
        try {
            const result = await this.send(payload);
            return { delivered: result.success, error: result.error };
        } catch (err) {
            return { delivered: false, error: err instanceof Error ? err.message : String(err) };
        }
    }

    // Audit-log failure must never block the actual send flow.
    private async recordAttempt(
        payload: EmailPayload,
        meta: { status: 'sent' | 'failed'; resendEmailId?: string; errorMessage?: string },
    ): Promise<string | undefined> {
        try {
            const [row] = await db.insert(emailSends).values({
                type: payload.type,
                toEmail: payload.to,
                subject: payload.subject,
                htmlBody: capBody(payload.html),
                status: meta.status,
                resendEmailId: meta.resendEmailId ?? null,
                errorMessage: meta.errorMessage ?? null,
                userId: payload.userId ?? null,
            }).returning({ id: emailSends.id });
            return row?.id;
        } catch (err) {
            captureError(err, 'Failed to write email_sends row', {
                tags: { service: 'email', type: payload.type },
                extra: { to: payload.to, subject: payload.subject },
            });
            return undefined;
        }
    }
}

export const emailService = new EmailService();
