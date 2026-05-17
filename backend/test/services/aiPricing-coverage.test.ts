/**
 * Guard test: every model in `ALLOWED_AI_MODELS` must have an `AI_PRICING`
 * row. A model that's allowlisted but unpriced silently bills $0 in
 * `ai_usage_log` — exactly the regression that put `gpt-5.4-nano` into a
 * customer's `settings.ai_model` without anyone noticing the cost lie. This
 * test fails fast at CI time instead.
 */
import { describe, it, expect } from 'vitest';
import { ALLOWED_AI_MODELS } from '@jawab24/shared';
import { AI_PRICING } from '../../src/config/aiPricing';

describe('AI_PRICING coverage of ALLOWED_AI_MODELS', () => {
    for (const model of ALLOWED_AI_MODELS) {
        it(`has a pricing row for ${model}`, () => {
            const row = (AI_PRICING as Record<string, unknown>)[model];
            expect(row, `missing AI_PRICING entry for "${model}" — add it to backend/src/config/aiPricing.ts`).toBeDefined();
        });
    }
});
