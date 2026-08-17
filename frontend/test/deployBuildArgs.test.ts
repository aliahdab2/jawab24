import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Deployment build-arg parity.
 *
 * `NEXT_PUBLIC_*` values are INLINED by `next build`. A var the compose file
 * forgets to pass is constant-folded to `undefined` inside the image, and no
 * amount of runtime env (`env_file:`) can repair it — the code that reads it is
 * already gone. The failure is silent: no exception, no log, just a feature
 * that quietly does nothing.
 *
 * That is exactly what happened on 2026-08-02. `docker-compose.blue.yml` and
 * `docker-compose.green.yml` declared `frontend-blue` / `frontend-green` as
 * separate services with a SHORTER arg list than the base `frontend` service —
 * missing the Stripe publishable key, the Sentry DSN and the GA id. All three
 * services tag the same image (`jawab24-frontend:latest`), so while the deploy
 * built every service the correct image sometimes won the tag by luck. Once the
 * deploy was narrowed to build only `frontend-$DEPLOY_ENV` (PR #606), the
 * arg-less image won every time: `getStripePromise()` compiled to
 * `return null`, the PaymentElement could not mount, and every merchant saw a
 * checkout with no card form — with the frontend's own Sentry dark, so nothing
 * was reported.
 *
 * Unit tests could never catch it: they mock `getStripePromise`, and the CI
 * `next build` always passes `pk_test_placeholder`. The defect lives entirely
 * in the gap between what the Dockerfile declares and what compose passes, so
 * that gap is what this test asserts.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.blue.yml',
  'docker-compose.green.yml',
] as const;

/** Build args the frontend Dockerfile declares, in declaration order. */
function declaredDockerfileArgs(): string[] {
  const dockerfile = readFileSync(path.join(repoRoot, 'frontend', 'Dockerfile'), 'utf8');
  return [...dockerfile.matchAll(/^ARG\s+([A-Z0-9_]+)/gm)]
    .map((m) => m[1])
    // ALLOW_MISSING_PUBLIC_ENV is a local-build escape hatch, never a deploy input.
    .filter((name) => name !== 'ALLOW_MISSING_PUBLIC_ENV');
}

/**
 * Map every service that builds frontend/Dockerfile to the build-arg names it
 * passes. Hand-rolled rather than pulling in a YAML parser: the shape is a
 * fixed two-level block and a dependency for one assertion is not worth it.
 */
function frontendServiceArgs(composeFile: string): Record<string, string[]> {
  const source = readFileSync(path.join(repoRoot, composeFile), 'utf8');
  const lines = source.split('\n');
  const services: Record<string, string[]> = {};

  let currentService: string | null = null;
  let buildsFrontend = false;
  let inArgs = false;
  let args: string[] = [];

  const flush = () => {
    if (currentService && buildsFrontend) services[currentService] = args;
    buildsFrontend = false;
    inArgs = false;
    args = [];
  };

  for (const line of lines) {
    const serviceHeader = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (serviceHeader) {
      flush();
      currentService = serviceHeader[1];
      continue;
    }
    if (!currentService) continue;

    if (/^\s*dockerfile:\s*frontend\/Dockerfile\s*$/.test(line)) buildsFrontend = true;
    if (/^\s*args:\s*$/.test(line)) { inArgs = true; continue; }

    if (inArgs) {
      const arg = /^\s*-\s*([A-Z0-9_]+)=/.exec(line);
      if (arg) { args.push(arg[1]); continue; }
      // Any non-list, non-comment line ends the args block.
      if (line.trim() !== '' && !line.trim().startsWith('#')) inArgs = false;
    }
  }
  flush();

  return services;
}

describe('frontend image build args', () => {
  const declared = declaredDockerfileArgs();

  it('declares the Stripe publishable key as a Dockerfile ARG', () => {
    expect(declared).toContain('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  });

  it.each(COMPOSE_FILES)('%s defines exactly one frontend-building service', (composeFile) => {
    expect(Object.keys(frontendServiceArgs(composeFile))).toHaveLength(1);
  });

  it.each(COMPOSE_FILES)('%s passes every build arg the Dockerfile declares', (composeFile) => {
    for (const [service, args] of Object.entries(frontendServiceArgs(composeFile))) {
      const missing = declared.filter((name) => !args.includes(name));
      expect(
        missing,
        `${composeFile} service "${service}" omits ${missing.join(', ')} — ` +
        'these are inlined at build time and cannot be supplied at runtime',
      ).toEqual([]);
    }
  });

  it('passes the payment keys in every environment', () => {
    // Named separately from the parity check above: this is the regression the
    // 2026-08-02 dead-checkout incident produced, and it must fail loudly and
    // unambiguously if the key is ever dropped again.
    for (const composeFile of COMPOSE_FILES) {
      for (const [service, args] of Object.entries(frontendServiceArgs(composeFile))) {
        expect(args, `${composeFile}:${service} must pass the Stripe publishable key`)
          .toContain('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
        expect(args, `${composeFile}:${service} must pass the Sentry DSN`)
          .toContain('NEXT_PUBLIC_SENTRY_DSN');
      }
    }
  });

  it('passes an identical arg set in every environment', () => {
    // All three services tag jawab24-frontend:latest, so whichever one a deploy
    // happens to build must produce the same image.
    const perFile = COMPOSE_FILES.map((composeFile) => {
      const [args] = Object.values(frontendServiceArgs(composeFile));
      return { composeFile, args: [...args].sort() };
    });
    const [baseline, ...rest] = perFile;
    for (const other of rest) {
      expect(other.args, `${other.composeFile} drifted from ${baseline.composeFile}`)
        .toEqual(baseline.args);
    }
  });
});

/**
 * Every `NEXT_PUBLIC_*` the app READS must be one the image BUILDS with.
 *
 * The parity block above compares the Dockerfile to compose — it cannot see a
 * var that is missing from BOTH. When that happens the two sides agree, every
 * assertion passes, and the feature is still dead: `next build` inlines the
 * unknown var as `undefined`, so `=== 'true'` is constant-folded to `false` and
 * the code is dropped from the bundle entirely.
 *
 * That is how Instagram-direct connect shipped dark on 2026-08-16.
 * `NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED` was read by `isInstagramDirectEnabled()`
 * but declared nowhere, so the connect option could not appear no matter what
 * the server's env said — and setting it there was the natural (wrong) fix to
 * reach for, because nothing in the repo hinted the var was never wired.
 *
 * The same sweep found two more levers in that state, both of which look ready
 * until the day you need them: NEXT_PUBLIC_CHECKOUT_MAINTENANCE (the
 * kill switch for a payments incident) and NEXT_PUBLIC_PHONE_AUTH_ENABLED (the
 * flag that turns phone auth back on when WhatsApp OTP ships).
 *
 * So this block asserts the direction the parity check cannot: source → build.
 */
describe('every NEXT_PUBLIC_* read by the app is a real build input', () => {
  /**
   * Vars deliberately NOT passed at build time. Each needs a reason — an
   * unexplained entry here recreates exactly the blind spot this test exists to
   * close, so treat adding one as a decision, not a formality.
   */
  const NOT_BUILD_INPUTS: Record<string, string> = {
    // Supplied by next.config.js `env`, which defaults it to the production
    // origin — so the build never depends on the deploy passing it.
    NEXT_PUBLIC_SITE_URL: 'defaulted to the production origin in next.config.js env',
    // GENERATED, not passed: next.config.js `env` sets it to new Date() at build
    // time. Wiring a build arg for it would be dead config — nothing to pass.
    NEXT_PUBLIC_BUILD_TIME: 'generated at build time by next.config.js env',
    // Documented in featureFlags.ts as a LOCAL-DEV override of the hardcoded
    // pilot list; production is meant to use the built-in list.
    NEXT_PUBLIC_POST_SUGGESTIONS_WORKSPACE_IDS: 'local-dev override by design',
    // Same pattern (D-085): the InMedia pilot workspace is the built-in
    // default; the env var exists only to point local dev at another
    // workspace. GA deletes the gate in code — never flips this var.
    NEXT_PUBLIC_REPLY_MODE_WORKSPACE_IDS: 'local-dev override by design',
  };

  /** `NEXT_PUBLIC_*` names the Dockerfile puts into the build environment. */
  function inlinedByDockerfile(): Set<string> {
    const dockerfile = readFileSync(path.join(repoRoot, 'frontend', 'Dockerfile'), 'utf8');
    // Match the ENV side, not ARG: NEXT_PUBLIC_APP_VERSION is fed by the
    // differently-named SEMANTIC_VERSION arg, and what `next build` can see is
    // precisely the set of exported ENV names.
    return new Set(
      [...dockerfile.matchAll(/^ENV\s+(NEXT_PUBLIC_[A-Z0-9_]+)=/gm)].map((m) => m[1]),
    );
  }

  /** Every `process.env.NEXT_PUBLIC_*` read in shipped frontend source. */
  function publicVarsReadInSource(): Map<string, string> {
    const srcRoot = path.join(repoRoot, 'frontend', 'src');
    const found = new Map<string, string>();

    for (const entry of readdirSync(srcRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;

      const full = path.join(entry.parentPath ?? entry.path, entry.name);
      const rel = path.relative(repoRoot, full);
      // Tests stub env freely (vi.stubEnv) — they are not shipped code and must
      // not drag a var into the required set.
      if (/(?:^|[\\/])__tests__[\\/]/.test(rel) || /\.(?:test|spec)\./.test(entry.name)) continue;

      for (const m of readFileSync(full, 'utf8').matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) {
        if (!found.has(m[1])) found.set(m[1], rel);
      }
    }
    return found;
  }

  it('finds the vars it is meant to police', () => {
    // Guards the scanner itself: a regex or walker that silently matched
    // nothing would make every assertion below pass vacuously.
    const read = publicVarsReadInSource();
    expect(read.size).toBeGreaterThan(5);
    expect([...read.keys()]).toContain('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  });

  it('passes every var the source reads as a build arg', () => {
    const inlined = inlinedByDockerfile();
    const missing = [...publicVarsReadInSource()]
      .filter(([name]) => !inlined.has(name) && !(name in NOT_BUILD_INPUTS))
      .map(([name, file]) => `${name} (read in ${file})`);

    expect(
      missing,
      'These are read at runtime but never supplied at build time, so Next.js ' +
      'inlines them as `undefined` and the feature is dead in the image. Add an ' +
      'ARG + ENV in frontend/Dockerfile and the build arg to all three compose ' +
      'files — or, if the var is genuinely not a deploy input, add it to ' +
      'NOT_BUILD_INPUTS with a reason.',
    ).toEqual([]);
  });

  it('keeps the allowlist honest — no entry for a var nothing reads', () => {
    // A stale exemption is how a real gap sneaks back in under cover of an
    // entry that looks reviewed.
    const read = new Set(publicVarsReadInSource().keys());
    const stale = Object.keys(NOT_BUILD_INPUTS).filter((name) => !read.has(name));
    expect(stale, 'remove these from NOT_BUILD_INPUTS — the source no longer reads them').toEqual([]);
  });

  it('documents a reason for every allowlisted var', () => {
    for (const [name, reason] of Object.entries(NOT_BUILD_INPUTS)) {
      expect(reason.trim().length, `${name} needs a real reason`).toBeGreaterThan(15);
    }
  });
});

describe('frontend Dockerfile guard', () => {
  const dockerfile = readFileSync(path.join(repoRoot, 'frontend', 'Dockerfile'), 'utf8');

  it('refuses to build without a Stripe publishable key', () => {
    // Prevention over detection: a build that would ship a dead checkout must
    // fail, not warn. The compose parity above only covers the wiring we own —
    // this covers a hand-run `docker build` too.
    expect(dockerfile).toMatch(/if \[ -z "\$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" \]/);
    expect(dockerfile).toMatch(/exit 1/);
  });

  it('runs the guard before the Next.js build', () => {
    const guardAt = dockerfile.indexOf('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" ]');
    const buildAt = dockerfile.indexOf('npm run build --workspace=jawab24-frontend');
    expect(guardAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(guardAt);
  });
});
