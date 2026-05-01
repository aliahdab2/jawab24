import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { db } from '../db';
import { emailSends } from '../db/schema';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

// Email type discriminator stored on `email_sends.type`. Add new values here
// as new email kinds ship — keeps the union exhaustive at every call site.
export type EmailType = 'lead_digest' | 'waitlist' | 'transactional' | 'subscription_welcome';

interface EmailPayload {
    to: string;
    subject: string;
    html: string;
    type: EmailType;
    // Optional owner of the email (recipient user). Stored on email_sends so
    // admins can filter "show me everything we sent to user X".
    userId?: string | null;
}

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
export class EmailService {
    private logger: Logger = noopLogger;
    setLogger(l: Logger): void { this.logger = l; }

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

        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.resend.apiKey}`,
            },
            body: JSON.stringify({
                from: `${config.resend.fromName} <${config.resend.fromEmail}>`,
                to: [payload.to],
                subject: payload.subject,
                html: payload.html,
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
