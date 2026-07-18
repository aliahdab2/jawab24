/**
 * Max length for customer-facing message templates (greeting, away message,
 * limit-fallback). Tied to Instagram DM limit (1000 chars) — the strictest
 * platform we send to. Anything longer would be rejected by Meta when
 * delivering to IG threads.
 */
export const MAX_TEMPLATE_MESSAGE_LENGTH = 1000;

/**
 * Post Reply (per-post keyword trigger) limits — the SINGLE source of truth for
 * both the backend validator (`services/reply/postReplyRule.ts`) and the frontend
 * modal (`PostTriggerModal.tsx`), so the field caps and the server enforcement can
 * never drift.
 */
export const POST_REPLY_MAX_KEYWORDS = 10;
export const POST_REPLY_MAX_KEYWORD_LEN = 100;
export const POST_REPLY_MAX_REPLY_LEN = 1000;
/**
 * With an image attached, the reply is delivered as a Meta generic-template card
 * (title ≤80 + subtitle ≤80), so the reply caps at 160. The frontend hard-blocks
 * Save above this; the backend enforces it as the authority.
 */
export const POST_REPLY_MAX_REPLY_LEN_WITH_IMAGE = 160;
/** Post Reply image upload limits (DM-modes only). */
export const POST_REPLY_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB decoded
export const POST_REPLY_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Max length for the Reply Personality / brand-voice note. Unlike the template
 * messages above, this is NOT sent to customers — it's injected into the AI
 * system prompt. This single value is the source of truth for BOTH the editor
 * field's max length AND the prompt-injection slice, so a merchant's full
 * persona always reaches the model (no silent truncation). Sized to fit a
 * structured persona — identity, voice, signature phrases, style, and goal —
 * with headroom, while bounding prompt cost.
 */
export const MAX_BRAND_VOICE_LENGTH = 800;

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
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
] as const;

export type AllowedAiModel = (typeof ALLOWED_AI_MODELS)[number];

export function isAllowedAiModel(model: string | null | undefined): model is AllowedAiModel {
    return !!model && (ALLOWED_AI_MODELS as readonly string[]).includes(model);
}
