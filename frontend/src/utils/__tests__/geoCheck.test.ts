import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCachedGeoCountry,
  hasLocalPaymentAlternative,
  isUserSanctioned,
  isUserSanctionedNonBlocking,
} from '../geoCheck';

const GEO_CACHE_KEY = 'jawab24_geo_check';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('hasLocalPaymentAlternative', () => {
  it('is true for Syria', () => {
    expect(hasLocalPaymentAlternative('SY')).toBe(true);
  });

  it('is case-insensitive — the cache stores whatever the API returned', () => {
    expect(hasLocalPaymentAlternative('sy')).toBe(true);
  });

  it('is false for other blocked regions', () => {
    // Cuba, Iran and North Korea are blocked too, but have no rail we offer.
    for (const country of ['CU', 'IR', 'KP']) {
      expect(hasLocalPaymentAlternative(country)).toBe(false);
    }
  });

  it('is false when the country is unknown', () => {
    // The payment-mode check fails CLOSED, so "blocked" does not imply "resolved".
    expect(hasLocalPaymentAlternative(undefined)).toBe(false);
    expect(hasLocalPaymentAlternative('')).toBe(false);
  });
});

describe('getCachedGeoCountry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the country written by a geo check', () => {
    localStorage.setItem(
      GEO_CACHE_KEY,
      JSON.stringify({ sanctioned: true, country: 'SY', timestamp: Date.now() }),
    );
    expect(getCachedGeoCountry()).toBe('SY');
  });

  it('returns undefined when nothing is cached', () => {
    expect(getCachedGeoCountry()).toBeUndefined();
  });

  it('returns undefined for an expired entry', () => {
    localStorage.setItem(
      GEO_CACHE_KEY,
      JSON.stringify({ sanctioned: true, country: 'SY', timestamp: Date.now() - DAY_MS - 1000 }),
    );
    expect(getCachedGeoCountry()).toBeUndefined();
  });

  it('returns undefined for a corrupt entry rather than throwing', () => {
    localStorage.setItem(GEO_CACHE_KEY, 'not-json');
    expect(getCachedGeoCountry()).toBeUndefined();
  });

  it('returns undefined when the cached verdict carries no country', () => {
    localStorage.setItem(
      GEO_CACHE_KEY,
      JSON.stringify({ sanctioned: true, timestamp: Date.now() }),
    );
    expect(getCachedGeoCountry()).toBeUndefined();
  });
});

describe('SIMULATE_SANCTIONS override', () => {
  beforeEach(() => {
    localStorage.clear();
    // No test here may reach the network — an override that falls through to
    // fetch would pass for the wrong reason.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled in test'));
  });

  it('blocks and resolves the country when set to an ISO code', async () => {
    localStorage.setItem('SIMULATE_SANCTIONS', 'SY');
    await expect(isUserSanctioned()).resolves.toBe(true);
    // Cached, so the sanctioned UI can render the region-specific copy.
    expect(getCachedGeoCountry()).toBe('SY');
  });

  it('lowercase code is normalised', async () => {
    localStorage.setItem('SIMULATE_SANCTIONS', 'sy');
    await isUserSanctionedNonBlocking(50);
    expect(getCachedGeoCountry()).toBe('SY');
  });

  it('plain "true" blocks with no country — the fail-closed shape', async () => {
    localStorage.setItem('SIMULATE_SANCTIONS', 'true');
    const result = await isUserSanctionedNonBlocking(50);
    expect(result.sanctioned).toBe(true);
    expect(getCachedGeoCountry()).toBeUndefined();
  });

  it('ignores a value that is neither "true" nor an ISO code', async () => {
    // A stray 'false'/'0' left in storage must not block a real merchant.
    for (const junk of ['false', '0', 'yes', 'SYR']) {
      localStorage.clear();
      localStorage.setItem('SIMULATE_SANCTIONS', junk);
      // The override is skipped, so the (disabled) network path runs and the
      // no-cache fail-closed rule applies — never the simulated shortcut.
      const result = await isUserSanctionedNonBlocking(50);
      expect(result.sanctioned, `"${junk}" must not trip the override`).toBe(false);
    }
  });
});
