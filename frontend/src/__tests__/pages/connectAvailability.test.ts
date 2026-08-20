import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The integrations page must never offer a connect flow the backend would refuse.
 *
 * Read from the Salla Partners portal on 2026-08-20: app 665811310 has OAuth Mode =
 * **Easy Mode**, which drops the registered redirect URIs, so Salla 404s the OAuth
 * authorize endpoint — and no App Store listing is published yet, so there is nothing to
 * redirect to instead. `GET /salla/capabilities` therefore answers
 * `connectAvailable: false`, and every connect/reconnect action must disappear with it.
 *
 * ⚠️ **What this spec can and cannot prove.** These are assertions about SOURCE TEXT, not
 * about rendered output — there is no render harness for this page today, so a regex is
 * what is available. It cannot prove the branch renders correctly, only that the branch
 * exists and that no availability decision is hardcoded. The behavioural contract lives in
 * `backend/test/controllers/salla.test.ts` (the predicate, the 404, and the auth-redirect
 * guard) and `backend/test/routes/ecommerceRoutes.test.ts` (the capabilities endpoint),
 * which are real behaviour tests. Treat this file as a regression guard against
 * re-introducing a hardcode, not as UI coverage.
 *
 * Mutation check: hardcode availability in a card, or drop the `!connectAvailable` branch,
 * and these fail.
 *
 * When the listing goes live: set SALLA_APP_STORE_URL — the backend starts answering
 * `connectAvailable: true` and the UI follows with no code change. This spec stays valid.
 */
describe('integrations page takes connect availability from the backend', () => {
  const source = readFileSync(resolve(__dirname, '../../pages/integrations.tsx'), 'utf-8');

  it('fetches the capability instead of hardcoding it per platform', () => {
    expect(source).toMatch(/getPlatformCapabilities\(platform\.id\)/);
    // The old shape: a per-platform literal in the PLATFORMS array. If this ever comes
    // back, the backend and the UI can disagree again — the bug this replaced.
    expect(source).not.toMatch(/connectEnabled:\s*(true|false)/);
  });

  it('defaults to available when the capability is unknown', () => {
    // Fail-open: a failed fetch, or a platform whose backend predates the route, must
    // keep working exactly as before. The backend stays the authority that refuses.
    expect(source).toMatch(/\[platformId\] !== false/);
  });

  it('gates the connect button, its hint and its handler on the same answer', () => {
    expect(source).toMatch(/\{!connectAvailable \?/);
    expect(source).toMatch(/notConnected\.connectNotOpen/);
    expect(source).toMatch(/\{connectAvailable && !platform\.requiresDomain &&/);
    expect(source).toMatch(/if \(!connectAvailable\) return;/);
  });

  it('gates reconnect too — it points at the same OAuth redirect', () => {
    // Reconnect navigates to GET /<platform>/auth, the identical dead URL. Guarding only
    // the connect button would leave this path open.
    expect(source).toMatch(/canEdit && connectAvailable &&/);
    expect(source).toMatch(/\{connectAvailable && \(/);
  });
});
