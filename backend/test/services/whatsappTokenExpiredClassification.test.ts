import { describe, it, expect } from 'vitest';
import { classifyDmError } from '../../src/utils/fbGraphErrors';
import { WhatsAppApiError } from '../../src/services/whatsapp';

/**
 * Regression: an expired WhatsApp token must NOT be classified 'unknown'.
 *
 * Meta forces a 60-day expiry on WhatsApp Embedded Signup business tokens. Before
 * this fix, a 190 from a dead token had no WhatsApp entry in BUCKET_TABLE (which is
 * keyed by FbPlatform), so it fell through to bucket 'unknown' — a PAGE-LEVEL bucket
 * that counts toward the defensive auto-pause threshold. The result in production
 * would have been: 10 customer messages burned into `delivery_failed`, then the page
 * auto-paused with reason 'send_rejected', and nothing anywhere telling the merchant
 * their WhatsApp had expired.
 *
 * 'our_fault' is the correct bucket — it is what FB/IG already use for
 * token-expired/permission-lost (mapped to DM_PLATFORM_AUTH, "merchant must
 * reconnect"), and it keeps the failure legible instead of silent.
 *
 * The classification is duck-typed on `metaCode` rather than on the platform, so no
 * `platform === 'whatsapp'` branch leaks into the shared pipeline (DECISIONS D-016).
 */
describe('classifyDmError — WhatsApp token expiry (190)', () => {
    it('buckets an expired WhatsApp token as our_fault, not unknown', () => {
        const err = new WhatsAppApiError('Error validating access token: Session has expired', 190, false);

        // `platform` is irrelevant here — the branch keys on the error, not the channel.
        const result = classifyDmError(err, 'facebook');

        expect(result.bucket).toBe('our_fault');
        expect(result.code).toBe(190);
    });

    it('still prefers transient when the error self-declares retryability', () => {
        // A 5xx/429/network WhatsAppApiError must stay retry-worthy even if it somehow
        // also carried an auth code — burning the BullMQ retry on a Meta blip is worse.
        const err = new WhatsAppApiError('Service unavailable', 190, true);
        expect(classifyDmError(err, 'facebook').bucket).toBe('transient');
    });

    it('leaves other WhatsApp Meta codes in their existing buckets', () => {
        // 131047 (24h window) has no WhatsApp BUCKET_TABLE entry either and is
        // deliberately still 'unknown' here — the manual-reply path maps it via
        // mapWhatsAppSendError. This test pins that the 190 branch is narrow and did
        // not silently re-bucket every WhatsApp error.
        const windowErr = new WhatsAppApiError('Re-engagement required', 131047, false);
        expect(classifyDmError(windowErr, 'facebook').bucket).toBe('unknown');
    });

    it('does not disturb a plain Error with no Meta code', () => {
        expect(classifyDmError(new Error('boom'), 'facebook').bucket).toBe('unknown');
    });
});
