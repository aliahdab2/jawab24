import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
