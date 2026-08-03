import { describe, it, expect } from 'vitest';
import { isCatalogVisible } from '@/lib/featureFlags';

const FOUNDER_WS = 'a0005407-92bf-473e-9368-013f14c57a7d';

describe('isCatalogVisible — business surface gate (admin OR founder-team workspace)', () => {
  it('platform admin passes regardless of workspaces', () => {
    expect(isCatalogVisible({ isAdmin: true })).toBe(true);
    expect(isCatalogVisible({ isAdmin: true }, [])).toBe(true);
  });

  it('a member of the founder workspace passes without platform admin', () => {
    expect(isCatalogVisible({ isAdmin: false }, [FOUNDER_WS])).toBe(true);
    expect(isCatalogVisible({ isAdmin: false }, ['other-ws', FOUNDER_WS])).toBe(true);
  });

  it('everyone else stays gated — including missing user or workspaces', () => {
    expect(isCatalogVisible({ isAdmin: false }, ['some-other-workspace'])).toBe(false);
    expect(isCatalogVisible({ isAdmin: false })).toBe(false);
    expect(isCatalogVisible(null, [FOUNDER_WS.toUpperCase()])).toBe(false);
    expect(isCatalogVisible(undefined)).toBe(false);
  });
});
