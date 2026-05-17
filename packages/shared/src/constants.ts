/**
 * Max length for customer-facing message templates (greeting, away message,
 * limit-fallback, brand voice notes). Tied to Instagram DM limit (1000 chars)
 * — the strictest platform we send to. Anything longer would be rejected by
 * Meta when delivering to IG threads.
 */
export const MAX_TEMPLATE_MESSAGE_LENGTH = 1000;

/** Default AI model used across backend and ai-worker services */
export const DEFAULT_AI_MODEL = 'gpt-4.1-mini';

/**
 * Per-customer model overrides are validated against this allowlist before
 * being applied. Backend's `aiModelResolver` falls back to `DEFAULT_AI_MODEL`
 * for any value not in this set, so a typo in the `settings.ai_model` DB
 * column is a silent fallback, not a runtime error.
 *
 * **OpenAI-only intentionally.** The ai-worker's provider abstraction also
 * supports Claude models (`ai-worker/src/services/providers/index.ts`), but
 * `ANTHROPIC_API_KEY` is not provisioned in production env files — verified
 * by inspecting the live ai-worker container. Allowing Claude IDs here would
 * silently break replies for any customer routed to one. Re-add Claude entries
 * only after the key is wired up in `env/ai.env` AND an end-to-end test
 * against the real Anthropic API has passed.
 */
export const ALLOWED_AI_MODELS = [
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4.1',
    'gpt-4o-mini',
    'gpt-5-nano',
    'gpt-5-mini',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
] as const;

export type AllowedAiModel = (typeof ALLOWED_AI_MODELS)[number];

export function isAllowedAiModel(model: string | null | undefined): model is AllowedAiModel {
    return !!model && (ALLOWED_AI_MODELS as readonly string[]).includes(model);
}
