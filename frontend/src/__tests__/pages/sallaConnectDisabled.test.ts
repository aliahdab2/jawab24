import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The Salla card must NOT offer a Connect button while the flow behind it is dead.
 *
 * Read from the Salla Partners portal on 2026-08-20: app 665811310 has OAuth Mode =
 * **Easy Mode**. Easy Mode drops the registered redirect URIs, so Salla 404s the OAuth
 * authorize endpoint — and no App Store listing is published yet, so `SALLA_APP_STORE_URL`
 * has nothing to point at either. Both branches of `connectStore` are therefore dead ends,
 * and a Connect button is a button to a Salla error page.
 *
 * Backend behaviour (409 SALLA_CONNECT_UNAVAILABLE) is pinned in
 * backend/test/controllers/salla.test.ts. This spec pins the UI half: the source must
 * declare the platform un-connectable, and the render must actually branch on it — a flag
 * nothing reads is the failure mode this is here to catch.
 *
 * Mutation check: flip `connectEnabled` to true (or drop it), or delete the
 * `connectEnabled === false` render branch, and these fail.
 *
 * When the listing goes live: set SALLA_APP_STORE_URL, remove `connectEnabled: false`,
 * and delete this spec — the guard has served its purpose.
 */
describe('Salla integration card does not offer a dead connect flow', () => {
  const source = readFileSync(resolve(__dirname, '../../pages/integrations.tsx'), 'utf-8');

  it('marks the salla platform as not connectable', () => {
    const sallaEntry = source.slice(source.indexOf("id: 'salla'"), source.indexOf("id: 'zid'"));
    expect(sallaEntry, 'salla platform entry not found').not.toBe('');
    expect(sallaEntry).toMatch(/connectEnabled:\s*false/);
  });

  it('leaves shopify and zid connectable — the guard is salla-specific', () => {
    const shopifyEntry = source.slice(
      source.indexOf("id: 'shopify'"),
      source.indexOf("id: 'salla'"),
    );
    const zidEntry = source.slice(source.indexOf("id: 'zid'"));
    expect(shopifyEntry).not.toMatch(/connectEnabled:\s*false/);
    expect(zidEntry).not.toMatch(/connectEnabled:\s*false/);
  });

  it('branches the render on connectEnabled instead of only storing it', () => {
    expect(source).toMatch(/platform\.connectEnabled === false \?/);
    expect(source).toMatch(/notConnected\.connectNotOpen/);
  });

  it('hides the "you will be redirected to Salla" hint along with the button', () => {
    // Caught in self-review: gating only the Button left the card promising a redirect
    // that can no longer happen — sallaConnectHint is "You will be redirected to Salla
    // to authorize". Whatever describes the connect action must disappear with it.
    expect(source).toMatch(/platform\.connectEnabled !== false && !platform\.requiresDomain/);
  });

  it('refuses the connect handler for an un-connectable platform', () => {
    expect(source).toMatch(/if \(platform\.connectEnabled === false\) return;/);
  });
});
