import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { whatsappConnectErrorKey } from '../whatsappConnectErrors';
import { isIOSNative } from '../capacitor';

vi.mock('../capacitor', () => ({ isIOSNative: vi.fn(() => false) }));

describe('whatsappConnectErrorKey', () => {
  beforeEach(() => {
    vi.mocked(isIOSNative).mockReturnValue(false);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Every gate the backend's checkWhatsAppConnectEntitlement chain can return.
  // A missing entry here is how the native leg came to file an ordinary billing
  // refusal to Sentry: null means "unexpected — capture it".
  it.each([
    ['WHATSAPP_PLAN_REQUIRED', 'whatsappPlanRequired'],
    ['WHATSAPP_SUBSCRIPTION_INACTIVE', 'subscriptionInactive'],
    ['WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE', 'whatsappUnavailableForMarketplace'],
    ['WHATSAPP_NUMBER_TAKEN', 'whatsappNumberTaken'],
    ['WHATSAPP_PIN_MISMATCH', 'whatsappPinMismatch'],
    ['WHATSAPP_NO_NUMBER', 'whatsappNoNumberSelected'],
    ['WHATSAPP_AMBIGUOUS', 'whatsappAmbiguousNumber'],
    // No copy of its own — keeps the generic message it always had, but it must
    // stay a KNOWN code so a canary refusal is shown, never captured.
    ['WHATSAPP_NOT_ALLOWLISTED', 'whatsappConnectFailed'],
  ])('maps %s to an expected-refusal message', (code, key) => {
    expect(whatsappConnectErrorKey(code)).toBe(key);
  });

  it('returns null for an unknown code, a missing code, and null — those must be captured, not shown', () => {
    expect(whatsappConnectErrorKey('WHATSAPP_CONNECT_FAILED')).toBeNull();
    expect(whatsappConnectErrorKey(undefined)).toBeNull();
    expect(whatsappConnectErrorKey(null)).toBeNull();
  });

  // App Store Guideline 3.1.1: no payment steering inside the iOS app. Both
  // billing refusals carry an iOS-neutral variant; the operational ones do not
  // need one. Mutation: drop either iosOr and this fails.
  it('swaps BOTH billing refusals for their iOS-neutral copy on iOS native', () => {
    vi.mocked(isIOSNative).mockReturnValue(true);
    expect(whatsappConnectErrorKey('WHATSAPP_PLAN_REQUIRED')).toBe('whatsappPlanRequiredIOS');
    expect(whatsappConnectErrorKey('WHATSAPP_SUBSCRIPTION_INACTIVE')).toBe('subscriptionInactiveIOS');
    // Not a billing message — unchanged.
    expect(whatsappConnectErrorKey('WHATSAPP_NUMBER_TAKEN')).toBe('whatsappNumberTaken');
  });
});
