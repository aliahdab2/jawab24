/**
 * Guard test: every model in `ALLOWED_AI_MODELS` (the backend-side allowlist
 * that gates per-customer `settings.ai_model` overrides) must have a matching
 * entry in the ai-worker's `MODEL_PROVIDERS` registry. Otherwise a customer
 * routed to a backend-allowed model would crash the ai-worker with
 * "Unknown model: …" — the exact failure mode that surfaced as
 * `failed_before_log:ecommerce_tools:gpt-5.4-nano:AiWorkerUnreachable` in
 * prod when the two registries drifted.
 */
import { describe, it, expect } from 'vitest';
import { ALLOWED_AI_MODELS } from '@jawab24/shared';
import { VALID_MODELS } from '../src/services/providers';

describe('ai-worker MODEL_PROVIDERS coverage of ALLOWED_AI_MODELS', () => {
    for (const model of ALLOWED_AI_MODELS) {
        it(`accepts ${model}`, () => {
            expect(
                VALID_MODELS.has(model),
                `missing MODEL_PROVIDERS entry for "${model}" — add it to ai-worker/src/services/providers/index.ts`,
            ).toBe(true);
        });
    }
});
