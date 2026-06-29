import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config', () => ({
    config: {
        openaiAdmin: { apiKey: 'sk-admin-secret-xyz', prodKeyId: 'key_prod', evalKeyId: 'key_eval' },
    },
}));

import { fetchCostRows, isOpenAiCostsConfigured } from '../../src/services/openaiCosts';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

describe('openaiCosts', () => {
    beforeEach(() => { vi.restoreAllMocks(); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('isOpenAiCostsConfigured reflects the admin key presence', () => {
        expect(isOpenAiCostsConfigured()).toBe(true);
    });

    it('parses the high-precision string amount, UTC date, and model from line item', async () => {
        const start = Math.floor(Date.UTC(2026, 5, 15) / 1000); // 2026-06-15 00:00 UTC
        const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({
            data: [{
                start_time: start,
                results: [
                    { amount: { value: '0.4843741800000000000000000000' }, api_key_id: 'key_prod', line_item: 'gpt-4.1-mini-2025-04-14, input' },
                    { amount: { value: '0.0100000000' }, api_key_id: 'key_eval', line_item: 'gpt-4o-mini-2024-07-18, output' },
                ],
            }],
            has_more: false,
            next_page: null,
        }));

        const rows = await fetchCostRows({ startTime: start, endTime: start + 86400 });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(rows).toEqual([
            { usageDate: '2026-06-15', apiKeyId: 'key_prod', model: 'gpt-4.1-mini-2025-04-14', lineItem: 'gpt-4.1-mini-2025-04-14, input', amountUsd: 0.48437418 },
            { usageDate: '2026-06-15', apiKeyId: 'key_eval', model: 'gpt-4o-mini-2024-07-18', lineItem: 'gpt-4o-mini-2024-07-18, output', amountUsd: 0.01 },
        ]);
    });

    it('follows has_more / next_page pagination and concatenates pages', async () => {
        const fetchMock = vi.spyOn(global, 'fetch')
            .mockResolvedValueOnce(jsonResponse({
                data: [{ start_time: 1781568000, results: [{ amount: { value: '1.00' }, api_key_id: 'key_prod', line_item: 'x, input' }] }],
                has_more: true,
                next_page: 'page_2',
            }))
            .mockResolvedValueOnce(jsonResponse({
                data: [{ start_time: 1781654400, results: [{ amount: { value: '2.00' }, api_key_id: 'key_prod', line_item: 'x, input' }] }],
                has_more: false,
                next_page: null,
            }));

        const rows = await fetchCostRows({ startTime: 1781568000, endTime: 1781740800 });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(rows.map(r => r.amountUsd)).toEqual([1, 2]);
        // page cursor forwarded on the 2nd call
        expect(String(fetchMock.mock.calls[1][0])).toContain('page=page_2');
    });

    it('skips malformed (non-finite) amounts instead of poisoning totals', async () => {
        vi.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({
            data: [{ start_time: 1781568000, results: [
                { amount: { value: 'not-a-number' }, api_key_id: 'key_prod', line_item: 'x, input' },
                { amount: { value: '0.50' }, api_key_id: 'key_prod', line_item: 'x, input' },
            ] }],
            has_more: false,
        }));

        const rows = await fetchCostRows({ startTime: 1781568000, endTime: 1781654400 });
        expect(rows).toHaveLength(1);
        expect(rows[0].amountUsd).toBe(0.5);
    });

    it('never leaks the admin key in a thrown error', async () => {
        // Persistent rejection so a stray second call can't fall through to real fetch.
        vi.spyOn(global, 'fetch').mockRejectedValue(new Error('boom Bearer sk-admin-secret-xyz leaked'));

        let caught: Error | undefined;
        try {
            await fetchCostRows({ startTime: 1, endTime: 2 });
        } catch (e) {
            caught = e as Error;
        }
        expect(caught).toBeDefined();
        expect(caught!.message).not.toContain('sk-admin-secret-xyz');
        expect(caught!.message).toContain('sk-***');
    });

    it('surfaces a non-2xx response as an error (without the key)', async () => {
        vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ error: { message: 'unauthorized' } }, false, 401));
        await expect(fetchCostRows({ startTime: 1, endTime: 2 })).rejects.toThrow(/401/);
    });
});
