import { config } from '../config';

/**
 * SMS Service — Vonage (Nexmo) delivery
 *
 * Swap provider here without touching OTP logic.
 * Phase 1: console log in development.
 * Phase 2: Vonage SMS (works in SA, SY, TR, SE and 200+ countries).
 * Phase 3: WhatsApp Cloud API as primary, Vonage SMS as fallback.
 */
export class SmsService {
    async send(phone: string, message: string): Promise<void> {
        if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log(`[SMS] ${phone}: ${message}`);
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
