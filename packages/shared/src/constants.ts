/**
 * Max length for customer-facing message templates (greeting, away message,
 * limit-fallback, brand voice notes). Tied to Instagram DM limit (1000 chars)
 * — the strictest platform we send to. Anything longer would be rejected by
 * Meta when delivering to IG threads.
 */
export const MAX_TEMPLATE_MESSAGE_LENGTH = 1000;

/** Default AI model used across backend and ai-worker services */
export const DEFAULT_AI_MODEL = 'gpt-4.1-mini';
