import { config } from '../config';
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
            return { success: false, error: err.message || `HTTP ${response.status}` };
        }

        const data = await response.json() as ResendResponse;
        return { success: true, id: data.id };
    }
}

export const emailService = new EmailService();
