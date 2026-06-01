import { config } from '../config';
import { isSmsBlockedPhone } from '@jawab24/shared';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

// The provider-undeliverable prefix list (Syria +963) lives in @jawab24/shared
// (SMS_BLOCKED_DIAL_PREFIXES) so the frontend can pre-empt a doomed OTP request
// instead of funnelling users into a guaranteed failure. Vonage rejects Syria
// with errorCode 15 (non-whitelisted destination), confirmed via dashboard CSV.
// Removal/changes are tracked with the WhatsApp Cloud API OTP work
// (see .planning/WHATSAPP_PLAN.md) — note WhatsApp is also sanctions-blocked for
// Syria, so +963 stays blocked when OTP moves to WhatsApp.
export class SmsCountryUnsupportedError extends Error {
    constructor(phone: string) {
        super(`SMS delivery not supported for ${phone}`);
        this.name = 'SmsCountryUnsupportedError';
    }
}

/**
 * SMS Service — Vonage (Nexmo) delivery
 *
 * Swap provider here without touching OTP logic.
 * Phase 1: logger.debug in development.
 * Phase 2: Vonage SMS (works in SA, TR, SE and 200+ countries; Syria blocked at provider level).
 * Phase 3: WhatsApp Cloud API as primary, Vonage SMS as fallback.
 */
export class SmsService {
    private logger: Logger = noopLogger;
    setLogger(l: Logger): void { this.logger = l; }

    async send(phone: string, message: string): Promise<void> {
        if (isSmsBlockedPhone(phone)) {
            throw new SmsCountryUnsupportedError(phone);
        }

        if (process.env.NODE_ENV === 'development') {
            this.logger.debug('SMS (dev)', { phone, message });
            return;
        }

        if (!config.vonage.apiKey || !config.vonage.apiSecret) {
            // Provider not configured — log and continue (Phase 1 behaviour)
            return;
        }

        const response = await fetch('https://rest.nexmo.com/sms/json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: config.vonage.apiKey,
                api_secret: config.vonage.apiSecret,
                from: config.vonage.senderId,
                to: phone.replace('+', ''), // Vonage expects no leading +
                text: message,
                type: 'unicode',
            }),
        });

        if (!response.ok) {
            throw new Error(`Vonage HTTP error: ${response.status}`);
        }

        const data = await response.json() as { messages: Array<{ status: string; 'error-text'?: string }> };
        const msg = data.messages?.[0];

        if (msg?.status !== '0') {
            // Status '0' = success in Vonage API
            throw new Error(`Vonage delivery error: ${msg?.['error-text'] ?? 'unknown'}`);
        }
    }
}

export const smsService = new SmsService();
