import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Mobile build-time env completeness — the Capacitor half of
 * `deployBuildArgs.test.ts`.
 *
 * `NEXT_PUBLIC_*` values are INLINED by `next build` and then baked into the
 * APK/IPA, so a missing one cannot be repaired by any runtime configuration:
 * the store binary ships without it until the next release.
 *
 * The failure this pins (2026-08-23): the mobile build never supplied
 * `NEXT_PUBLIC_SENTRY_DSN`. `next.config.js` wraps the app with Sentry only
 * when it is set, and `ErrorBoundary` reports a caught crash only when it is
 * set — so every shipped app contained no Sentry at all. Sentry recorded ZERO
 * events from `app.jawab24.com` in 90 days while the identical code on the web
 * reported normally. A merchant sat on the full-screen «حدث خطأ ما» boundary
 * and we had no stack, no route and no count: the crash was invisible by
 * construction, and the diagnosis had to be reconstructed from backend access
 * logs instead.
 *
 * The web side of this class is guarded by `deployBuildArgs.test.ts`; this is
 * the same guard for the side that ships to the stores.
 */

const require_ = createRequire(import.meta.url);
const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface BuildMobileScript {
  resolveBuildVar(
    key: string,
    opts: { env: Record<string, string | undefined>; files: string[] },
  ): { value: string | null; source: string | null };
  mobileBuildEnv(opts: {
    env: Record<string, string | undefined>;
    files: string[];
    now?: number;
  }): Record<string, string>;
  REQUIRED_VARS: string[];
}

const { resolveBuildVar, mobileBuildEnv, REQUIRED_VARS } = require_(
  path.join(frontendDir, 'scripts/build-mobile.js'),
) as BuildMobileScript;

const DSN = 'https://examplekey@o1.ingest.de.sentry.io/2';

/** A throwaway pair of env files standing in for `.env.local` and root `.env`. */
function envFiles(contents: Array<string | null>): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'mobile-env-'));
  return contents.map((text, i) => {
    const file = path.join(dir, `env-${i}`);
    if (text !== null) writeFileSync(file, text);
    return file; // a null entry names a file that does not exist
  });
}

describe('mobile build-time environment', () => {
  it('requires the Sentry DSN', () => {
    // Named explicitly, not derived: dropping the DSN from the required list is
    // precisely the regression that shipped, so it must fail here loudly.
    expect(REQUIRED_VARS).toContain('NEXT_PUBLIC_SENTRY_DSN');
  });

  it('takes the ambient environment first', () => {
    const files = envFiles([`NEXT_PUBLIC_SENTRY_DSN=${DSN}-from-file`]);
    const { value, source } = resolveBuildVar('NEXT_PUBLIC_SENTRY_DSN', {
      env: { NEXT_PUBLIC_SENTRY_DSN: DSN },
      files,
    });
    expect(value).toBe(DSN);
    expect(source).toBe('environment');
  });

  it('falls back to the env files in order', () => {
    const files = envFiles([null, `# comment\nNEXT_PUBLIC_SENTRY_DSN="${DSN}"\nOTHER=x`]);
    const { value, source } = resolveBuildVar('NEXT_PUBLIC_SENTRY_DSN', { env: {}, files });
    expect(value).toBe(DSN);
    expect(source).toBe(files[1]);
  });

  it('treats an empty value as missing', () => {
    // `${VAR:-}` in compose and a bare `KEY=` line both yield '', and an empty
    // DSN disables Sentry exactly as completely as an absent one. Accepting it
    // would let a blind build walk straight through this guard.
    const files = envFiles(['NEXT_PUBLIC_SENTRY_DSN=']);
    expect(resolveBuildVar('NEXT_PUBLIC_SENTRY_DSN', { env: { NEXT_PUBLIC_SENTRY_DSN: '  ' }, files }).value)
      .toBeNull();
  });

  it('refuses to build when the DSN is nowhere', () => {
    const files = envFiles([null, null]);
    let thrown: (Error & { missing?: string[] }) | null = null;
    try {
      mobileBuildEnv({ env: {}, files });
    } catch (e) {
      thrown = e as Error & { missing?: string[] };
    }
    expect(thrown, 'a DSN-less mobile build must fail, not warn').not.toBeNull();
    expect(thrown?.missing).toEqual(['NEXT_PUBLIC_SENTRY_DSN']);
    expect(thrown?.message).toContain('NEXT_PUBLIC_SENTRY_DSN');
  });

  it('hands the DSN and the mobile flags to next build', () => {
    const env = mobileBuildEnv({
      env: { NEXT_PUBLIC_SENTRY_DSN: DSN },
      files: envFiles([null, null]),
      now: 1234,
    });
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBe(DSN);
    expect(env.IS_MOBILE_BUILD).toBe('true');
    expect(env.NEXT_PUBLIC_API_URL).toBe('https://jawab24.com/api');
    expect(env.NEXT_PUBLIC_PHONE_AUTH_ENABLED).toBe('true');
    expect(env.NEXT_PUBLIC_BUILD_TIME).toBe('1234');
  });

  it('is the script `build:mobile` actually runs', () => {
    // The guard is worth nothing if the npm script goes back to invoking
    // `next build` directly — that inline form is what shipped the blind APK.
    const pkg = JSON.parse(readFileSync(path.join(frontendDir, 'package.json'), 'utf8'));
    const script: string = pkg.scripts['build:mobile'];
    expect(script).toContain('scripts/build-mobile.js');
    expect(script, 'build:mobile must not bypass the env guard').not.toMatch(/(^|&&\s*)(npx\s+)?next build/);
  });
});
