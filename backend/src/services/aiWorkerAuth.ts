import { config } from '../config';

/**
 * Build the headers for a backend → ai-worker HTTP call.
 *
 * The ai-worker gates its paid OpenAI/Anthropic generation endpoints on a shared
 * secret (the `X-AI-Worker-Secret` header). Every call site must go through this
 * helper so the secret is attached consistently — a missing header means the worker
 * (in production, where the secret is mandatory) rejects the request with 401.
 *
 * `extra` is merged on top for per-call headers (e.g. `X-Workspace-Id` for rate-limit
 * keying). The secret is only omitted when unset — local dev without `AI_WORKER_SECRET`,
 * where the worker also skips enforcement. Production requires it via env validation.
 */
export function aiWorkerHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...(extra ?? {}) };
    if (config.ai.workerSecret) {
        headers['X-AI-Worker-Secret'] = config.ai.workerSecret;
    }
    return headers;
}
