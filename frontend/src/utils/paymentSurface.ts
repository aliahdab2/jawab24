/**
 * Which payment surface `/checkout` shows — decided in ONE place.
 *
 * The page used to spread this over five sites (`isSanctioned === null`,
 * `isSanctioned || forceLocalRail`, `shamCashReady`, the Syria-link guard and
 * the login gate), which is how a sanctioned visitor got the "payments
 * unavailable" notice for the plan-fetch window and then watched it swap to the
 * Sham Cash panel, and how a logged-out Syrian visitor got the panel mounted
 * (→ 401 → notice with no login button). Both are states this function names.
 *
 * Pure so it can be tested exhaustively; the page only switches on the result.
 */

export type PaymentSurface =
  /** Geo unresolved, or a blocked visitor whose plan has not loaded yet. */
  | 'loading'
  /** The Stripe card page (which owns its own inner login/spinner/error states). */
  | 'card'
  /** The Sham Cash panel — a real payment screen for a merchant with a local rail. */
  | 'local_rail'
  /** "Payments are not available in your region" + WhatsApp. */
  | 'unavailable'
  /** A local rail exists but the panel reads the merchant's own claims — log in first. */
  | 'login';

export interface PaymentSurfaceInput {
  /** `null` while the strict geo check is still running. */
  isSanctioned: boolean | null;
  /** The visitor's resolved country has a self-serve rail (today: SY → Sham Cash). */
  hasLocalRail: boolean;
  /** The merchant said "I'm paying from inside Syria" under the card form (VPN case). */
  forceLocalRail: boolean;
  /** One-time reply top-up: never a plan claim, so never the panel. */
  isTopup: boolean;
  /** The plan being bought, once fetched. Price in cents. */
  plan: { price: number } | null;
  /** The plan fetch failed — nothing to wait for any more. */
  fetchError: boolean;
  isAuthenticated: boolean;
}

export function resolvePaymentSurface(input: PaymentSurfaceInput): PaymentSurface {
  const { isSanctioned, hasLocalRail, forceLocalRail, isTopup, plan, fetchError, isAuthenticated } = input;

  if (isSanctioned === null) return 'loading';

  // Not blocked by geo and not opting into the rail → the card page, whose own
  // branches (login gate, intent spinner, error banner) are unchanged.
  if (!isSanctioned && !forceLocalRail) return 'card';

  // A claim is filed against a PLAN; a top-up has none to review.
  if (isTopup) return 'unavailable';

  // Hold the spinner until the plan is known. Rendering the notice here and
  // swapping it for the panel a moment later is the flash this exists to stop;
  // once the fetch has failed there is nothing left to wait for.
  if (!plan) return fetchError ? 'unavailable' : 'loading';

  if (!hasLocalRail && !forceLocalRail) return 'unavailable';

  return isAuthenticated ? 'local_rail' : 'login';
}

/**
 * Whether to offer the "Paying from inside Syria?" link under the current
 * surface. The link is the VPN escape hatch: a Syrian merchant routinely
 * resolves to Europe, is NOT sanctioned by IP, and lands on the card form —
 * where the card declines. It is also offered under the unresolved-geo notice
 * (fails closed, so no panel by itself) so a Syrian merchant is not stranded
 * there either.
 *
 * Authenticated only: the panel it opens reads the merchant's own claims.
 * Never for a free plan (nothing to transfer for), a top-up, or once the rail
 * has already been chosen.
 */
export function shouldOfferFromSyriaLink(
  input: Pick<PaymentSurfaceInput, 'isTopup' | 'plan' | 'forceLocalRail' | 'isAuthenticated'>,
  surface: PaymentSurface,
): boolean {
  const { isTopup, plan, forceLocalRail, isAuthenticated } = input;
  if (surface !== 'card' && surface !== 'unavailable') return false;
  return !isTopup && !!plan && plan.price > 0 && isAuthenticated && !forceLocalRail;
}
