import { getBackendErrorCode, getStatusCode } from '@/lib/sentryHelpers';

/**
 * The 403 codes the workspace guards answer with (`middleware/workspace.ts`
 * `requireRole` / `resolveWorkspace`).
 *
 * - `INSUFFICIENT_ROLE` — the caller is in the workspace but below the role the
 *   route requires (a `member` on an `admin+` write).
 * - `WORKSPACE_ACCESS_DENIED` — the caller is no longer in the workspace at all.
 */
export type AuthorizationOutcome = 'INSUFFICIENT_ROLE' | 'WORKSPACE_ACCESS_DENIED';

const AUTHORIZATION_CODES: readonly string[] = ['INSUFFICIENT_ROLE', 'WORKSPACE_ACCESS_DENIED'];

/**
 * Classify a failed write as an AUTHORIZATION OUTCOME rather than a defect.
 *
 * Both codes are things the system is *supposed* to do: a `member` was refused,
 * or someone was removed from the workspace mid-session. Neither is a bug, so
 * neither belongs in Sentry — filing them made every ordinary refusal look like
 * a defect in the tracker (reported 2026-08-06, two teammates on Business Info).
 *
 * Returns the code when the error is one of those, `undefined` otherwise — so a
 * caller's `else` branch keeps reporting real failures exactly as before. This
 * lives in one place because THREE surfaces need the same verdict (Business
 * Info save, the fact-list writes, the single-fact save) and they must not drift
 * into disagreeing about which failures are bugs.
 */
/**
 * Outcome → the `common` namespace key that explains it to the merchant.
 *
 * A map rather than a ternary at each call site: two surfaces already needed
 * the identical `outcome === 'WORKSPACE_ACCESS_DENIED' ? … : …` line, and a
 * third code (there will be one) would have to be added in every one of them.
 * Surfaces with better, more specific copy of their own — the Business Info
 * save names the thing being saved — deliberately do not use this.
 */
export const AUTHORIZATION_MESSAGE_KEY: Record<AuthorizationOutcome, string> = {
  INSUFFICIENT_ROLE: 'errInsufficientRole',
  WORKSPACE_ACCESS_DENIED: 'errAccessRevoked',
};

export function authorizationOutcome(error: unknown): AuthorizationOutcome | undefined {
  if (getStatusCode(error) !== 403) return undefined;
  const code = getBackendErrorCode(error);
  return code !== undefined && AUTHORIZATION_CODES.includes(code)
    ? (code as AuthorizationOutcome)
    : undefined;
}
