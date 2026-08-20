import { describe, it, expect } from 'vitest';
import { pageContactChannel } from '@/utils/contactChannel';

/**
 * The tri-state is the whole point of this helper, so each state gets a test.
 * A boolean-returning version would collapse "unknown" into "no channel" and
 * accuse every legacy/mobile-shaped row of dead-ending its customers.
 */
describe('pageContactChannel', () => {
  it('trusts the server boolean on a LIST row', () => {
    expect(pageContactChannel({ hasContactChannel: true })).toBe(true);
    expect(pageContactChannel({ hasContactChannel: false })).toBe(false);
  });

  it('computes from the profile on a DETAIL row, with the same authority gate as the prompt', () => {
    expect(pageContactChannel({
      businessProfile: { merchant: { phones: [{ number: '0111222333' }] } },
    })).toBe(true);

    // Unconfirmed Facebook sync: the prompt omits it, so it is not a channel.
    expect(pageContactChannel({
      businessProfile: {
        merchant: { phones: [{ number: '0111222333' }] },
        merchantProvenance: { phones: { source: 'fb_sync' } },
      },
    })).toBe(false);

    // Email alone routes — INFO-DESK publishes it beside WhatsApp.
    expect(pageContactChannel({ businessProfile: { merchant: { email: 'hi@shop.com' } } })).toBe(true);

    // A profile with nothing routable.
    expect(pageContactChannel({ businessProfile: { merchant: { city: 'دمشق' } } })).toBe(false);
  });

  it('says UNKNOWN when neither shape is present', () => {
    // The legacy fat-shape row / an old mobile build: no boolean, no profile.
    expect(pageContactChannel({})).toBeUndefined();
    expect(pageContactChannel(null)).toBeUndefined();
    expect(pageContactChannel(undefined)).toBeUndefined();
  });

  it('prefers the server boolean over a profile, when a row somehow carries both', () => {
    expect(pageContactChannel({
      hasContactChannel: false,
      businessProfile: { merchant: { phones: [{ number: '0111222333' }] } },
    })).toBe(false);
  });
});
