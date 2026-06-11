import { createHmac } from 'crypto';
import { config } from '../config';

/**
 * Generate an HMAC token for unsubscribe links.
 * Uses JWT secret as the signing key — no extra env var needed.
 *
 * Lives here (not in routes/waitlist.ts) so both the waitlist route and the
 * admin email-send code can import it without a route→route dependency.
 */
export function generateUnsubscribeToken(email: string): string {
    const secret = config.jwt.secret || 'waitlist-fallback-key';
    return createHmac('sha256', secret).update(email.toLowerCase()).digest('hex');
}

/** Verify an unsubscribe token matches the email */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
    return generateUnsubscribeToken(email) === token;
}
