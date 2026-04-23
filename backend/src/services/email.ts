import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

interface EmailPayload {
    to: string;
    subject: string;
    html: string;
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
    id?: string;
    error?: string;
}

/**
 * Email Service — Resend delivery
 *
 * Follows the same singleton + graceful-degradation pattern as SmsService.
 * Phase 1: logger.debug in development.
 * Phase 2: Resend REST API (native fetch, no SDK).
 */
export class EmailService {
    private logger: Logger = noopLogger;
    setLogger(l: Logger): void { this.logger = l; }

    async send(payload: EmailPayload): Promise<SendResult> {
        if (process.env.NODE_ENV === 'development') {
            this.logger.debug('Email (dev)', {
                to: payload.to,
                subject: payload.subject,
            });
            return { success: true, id: 'dev-mode' };
        }

        if (!config.resend.apiKey) {
            this.logger.warn('Email not configured — RESEND_API_KEY is empty');
            captureError(
                new Error('Email provider not configured — RESEND_API_KEY is empty'),
                'email.send skipped — RESEND_API_KEY missing',
                { tags: { service: 'email' }, level: 'error', extra: { to: payload.to, subject: payload.subject } },
            );
            return { success: false, error: 'Email provider not configured' };
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
                    extra: { to: payload.to, subject: payload.subject, resendError: err },
                },
            );
            return { success: false, error: errorMessage };
        }

        const data = await response.json() as ResendResponse;
        return { success: true, id: data.id };
    }
}

export const emailService = new EmailService();
