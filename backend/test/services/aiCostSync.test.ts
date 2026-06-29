import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({ config: { aiCostMonitoring: { enabled: true } } }));
vi.mock('../../src/services/openaiCosts', () => ({
    isOpenAiCostsConfigured: vi.fn(),
    fetchCostRows: vi.fn(),
}));
vi.mock('../../src/services/aiCostSnapshots', () => ({ upsertSnapshots: vi.fn() }));
vi.mock('../../src/services/aiCostMonitor', () => ({ evaluateAndAlert: vi.fn() }));

import { runOpenAiCostSync } from '../../src/services/aiCostSync';
import { isOpenAiCostsConfigured, fetchCostRows } from '../../src/services/openaiCosts';
import { upsertSnapshots } from '../../src/services/aiCostSnapshots';
import { evaluateAndAlert } from '../../src/services/aiCostMonitor';

const NOW = new Date('2026-06-29T00:00:00Z');

describe('runOpenAiCostSync', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('no-ops (configured:false) when no admin key is configured — does not fetch', async () => {
        vi.mocked(isOpenAiCostsConfigured).mockReturnValue(false);

        const result = await runOpenAiCostSync(95, NOW);

        expect(result).toEqual({ configured: false, synced: 0 });
        expect(fetchCostRows).not.toHaveBeenCalled();
        expect(upsertSnapshots).not.toHaveBeenCalled();
        expect(evaluateAndAlert).not.toHaveBeenCalled();
    });

    it('fetches the trailing window, upserts, and re-evaluates the runway when configured', async () => {
        vi.mocked(isOpenAiCostsConfigured).mockReturnValue(true);
        vi.mocked(fetchCostRows).mockResolvedValue([
            { usageDate: '2026-06-28', apiKeyId: 'k', model: 'm', lineItem: 'm, input', amountUsd: 1 },
            { usageDate: '2026-06-29', apiKeyId: 'k', model: 'm', lineItem: 'm, input', amountUsd: 2 },
        ]);
        vi.mocked(upsertSnapshots).mockResolvedValue(2);
        vi.mocked(evaluateAndAlert).mockResolvedValue({} as never);

        const result = await runOpenAiCostSync(95, NOW);

        expect(result).toEqual({ configured: true, synced: 2 });
        const endTime = Math.floor(NOW.getTime() / 1000);
        expect(fetchCostRows).toHaveBeenCalledWith({ startTime: endTime - 95 * 86400, endTime });
        expect(upsertSnapshots).toHaveBeenCalledOnce();
        expect(evaluateAndAlert).toHaveBeenCalledWith(NOW);
    });
});
