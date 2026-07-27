import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
    config: { facebook: { graphApiVersion: 'v23.0', appId: 'app-1', appSecret: 'SUPER_SECRET' } },
}));

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import axios from 'axios';
import { whatsappService } from '../../src/services/whatsapp';

/**
 * Read receipts + typing indicator ("typing…") — the REQUEST CONTRACT with Meta.
 *
 * Why this file exists: the webhook tests mock `whatsappService` wholesale, so
 * they only prove the controller *called* markAsRead with `{ typing: true }`.
 * Nothing asserted what was actually POSTed to the Cloud API — a malformed body
 * would have kept every one of those tests green while the indicator silently
 * never rendered in production. That is exactly the symptom reported by the
 * founder on 2026-07-27 ("the write indicator does not appear always"), and it
 * was undiagnosable because the old implementation swallowed failures with a
 * bare `.catch(() => {})`.
 *
 * Two invariants are locked down here:
 *   1. the exact payload Meta requires (status + message_id + typing_indicator)
 *   2. the fire-and-forget contract — a receipt failure NEVER throws, because a
 *      cosmetic call must not be able to break a customer reply
 */
describe('whatsappService.markAsRead — Cloud API request contract', () => {
    beforeEach(() => vi.clearAllMocks());

    const POST_URL = 'https://graph.facebook.com/v23.0/PN-1/messages';

    it('sends read status + typing_indicator when a reply will follow', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { success: true } });

        const result = await whatsappService.markAsRead('PN-1', 'wamid.abc', 'TKN', { typing: true });

        expect(result).toEqual({ delivered: true });
        expect(axios.post).toHaveBeenCalledTimes(1);
        const [url, body, cfg] = vi.mocked(axios.post).mock.calls[0];
        expect(url).toBe(POST_URL);
        expect(body).toEqual({
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: 'wamid.abc',
            typing_indicator: { type: 'text' },
        });
        expect((cfg as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer TKN');
    });

    // Stickers are stored silently with no reply, so showing "typing…" would lie
    // to the customer. The field must be ABSENT, not `false` — Meta rejects an
    // unexpected shape, and a rejected receipt is invisible to the merchant.
    it('OMITS typing_indicator entirely when no reply will follow', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { success: true } });

        await whatsappService.markAsRead('PN-1', 'wamid.stk', 'TKN', { typing: false });

        const [, body] = vi.mocked(axios.post).mock.calls[0];
        expect(body).not.toHaveProperty('typing_indicator');
        expect(body).toEqual({
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: 'wamid.stk',
        });
    });

    it('defaults to no typing_indicator when options are omitted', async () => {
        vi.mocked(axios.post).mockResolvedValue({ data: { success: true } });

        await whatsappService.markAsRead('PN-1', 'wamid.plain', 'TKN');

        const [, body] = vi.mocked(axios.post).mock.calls[0];
        expect(body).not.toHaveProperty('typing_indicator');
    });

    // The whole point of the design: a cosmetic receipt must never be able to
    // break a reply. It must resolve — not reject — on any failure.
    it.each([
        ['Meta 4xx', { response: { status: 400, data: { error: { code: 100, message: 'Invalid parameter' } } } }, 'Invalid parameter'],
        ['rate limit', { response: { status: 429, data: { error: { code: 4, message: 'Rate limit hit' } } } }, 'Rate limit hit'],
        ['network error', { message: 'socket hang up' }, 'socket hang up'],
    ])('never throws on %s — reports delivered:false with the reason', async (_label, err, expectedReason) => {
        vi.mocked(axios.post).mockRejectedValue(err);

        const result = await whatsappService.markAsRead('PN-1', 'wamid.x', 'TKN', { typing: true });

        expect(result.delivered).toBe(false);
        expect(result.reason).toBe(expectedReason);
    });

    // Regression for the secret-leak rule: the failure reason is surfaced to the
    // logs, so it must carry Meta's message only — never the bearer token or the
    // axios config that holds it.
    it('failure reason never leaks the access token or request config', async () => {
        vi.mocked(axios.post).mockRejectedValue({
            message: 'Request failed with status code 401',
            config: { headers: { Authorization: 'Bearer SUPER_SECRET_TOKEN' } },
            response: { status: 401, data: { error: { code: 190, message: 'Token expired' } } },
        });

        const result = await whatsappService.markAsRead('PN-1', 'wamid.x', 'SUPER_SECRET_TOKEN', { typing: true });

        expect(result.delivered).toBe(false);
        expect(result.reason).toBe('Token expired');
        expect(JSON.stringify(result)).not.toContain('SUPER_SECRET_TOKEN');
        expect(JSON.stringify(result)).not.toContain('Bearer');
    });
});
