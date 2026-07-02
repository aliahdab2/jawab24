/**
 * Read a numeric env var PER CALL (not at startup) so the value doubles as a
 * no-redeploy kill-switch/tuning knob. Returns `fallback` when the var is
 * unset, empty, NaN, or negative. Distinct from utils/env.ts (the zod startup
 * schema), which validates once at boot by design.
 *
 * NOTE: services/protection/comment-debounce.ts predates this helper and
 * carries its own copy (parseInt-based) — migrate it here in a dedicated PR;
 * it is shared reply-pipeline infrastructure and deliberately not touched in
 * unrelated changes.
 */
export function envNumberPerCall(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    if (Number.isNaN(parsed) || parsed < 0) return fallback;
    return parsed;
}
