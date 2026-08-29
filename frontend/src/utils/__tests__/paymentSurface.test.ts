import { describe, it, expect } from 'vitest';
import { resolvePaymentSurface, shouldOfferFromSyriaLink, type PaymentSurfaceInput } from '../paymentSurface';

/**
 * The checkout surface decision, pinned as a table. Each row is a state the
 * page used to reach by accident (a notice that flashed before the panel, a
 * panel mounted for a logged-out visitor) or a product rule (top-ups never
 * take the rail; a free plan never offers the Syria link).
 */
const PAID = { price: 1500 };

function input(over: Partial<PaymentSurfaceInput> = {}): PaymentSurfaceInput {
  return {
    isSanctioned: false,
    hasLocalRail: false,
    forceLocalRail: false,
    isTopup: false,
    plan: PAID,
    fetchError: false,
    isAuthenticated: true,
    ...over,
  };
}

describe('resolvePaymentSurface', () => {
  it('is loading while the geo check has not answered', () => {
    expect(resolvePaymentSurface(input({ isSanctioned: null, plan: null }))).toBe('loading');
  });

  it('is the card page for an unblocked visitor, whatever else is set', () => {
    expect(resolvePaymentSurface(input())).toBe('card');
    expect(resolvePaymentSurface(input({ plan: null }))).toBe('card');
    expect(resolvePaymentSurface(input({ isAuthenticated: false }))).toBe('card');
    expect(resolvePaymentSurface(input({ hasLocalRail: true }))).toBe('card');
  });

  it('keeps the spinner up for a blocked visitor until the plan is known — no notice→panel flash', () => {
    expect(resolvePaymentSurface(input({ isSanctioned: true, hasLocalRail: true, plan: null }))).toBe('loading');
    // Also for a visitor with NO rail: the Syria link under the notice needs the plan too.
    expect(resolvePaymentSurface(input({ isSanctioned: true, plan: null }))).toBe('loading');
  });

  it('stops waiting once the plan fetch has failed', () => {
    expect(resolvePaymentSurface(input({ isSanctioned: true, hasLocalRail: true, plan: null, fetchError: true }))).toBe('unavailable');
  });

  it('shows the Sham Cash panel to a signed-in merchant with a local rail', () => {
    expect(resolvePaymentSurface(input({ isSanctioned: true, hasLocalRail: true }))).toBe('local_rail');
  });

  it('shows the login gate, never the panel, to a logged-out merchant with a local rail', () => {
    expect(resolvePaymentSurface(input({ isSanctioned: true, hasLocalRail: true, isAuthenticated: false }))).toBe('login');
  });

  it('shows the notice to a blocked visitor with no local rail', () => {
    expect(resolvePaymentSurface(input({ isSanctioned: true }))).toBe('unavailable');
  });

  it('never takes a top-up onto the rail, even inside Syria', () => {
    expect(resolvePaymentSurface(input({ isSanctioned: true, hasLocalRail: true, isTopup: true, plan: null }))).toBe('unavailable');
  });

  it('honours the merchant opting into the rail from the card page (VPN case)', () => {
    expect(resolvePaymentSurface(input({ forceLocalRail: true }))).toBe('local_rail');
    expect(resolvePaymentSurface(input({ forceLocalRail: true, plan: null }))).toBe('loading');
  });
});

describe('shouldOfferFromSyriaLink', () => {
  it('offers the link under the card form and under the notice', () => {
    expect(shouldOfferFromSyriaLink(input(), 'card')).toBe(true);
    expect(shouldOfferFromSyriaLink(input({ isSanctioned: true }), 'unavailable')).toBe(true);
  });

  it('never offers it once the rail is chosen or while loading', () => {
    expect(shouldOfferFromSyriaLink(input(), 'local_rail')).toBe(false);
    expect(shouldOfferFromSyriaLink(input(), 'login')).toBe(false);
    expect(shouldOfferFromSyriaLink(input({ plan: null }), 'loading')).toBe(false);
    expect(shouldOfferFromSyriaLink(input({ forceLocalRail: true }), 'card')).toBe(false);
  });

  it('requires a signed-in merchant and a paid plan', () => {
    expect(shouldOfferFromSyriaLink(input({ isAuthenticated: false }), 'card')).toBe(false);
    expect(shouldOfferFromSyriaLink(input({ plan: { price: 0 } }), 'card')).toBe(false);
    expect(shouldOfferFromSyriaLink(input({ plan: null }), 'unavailable')).toBe(false);
    expect(shouldOfferFromSyriaLink(input({ isTopup: true, plan: null }), 'unavailable')).toBe(false);
  });
});
