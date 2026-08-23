/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Runs the mobile (Capacitor static-export) Next build with a COMPLETE
 * `NEXT_PUBLIC_*` environment, and refuses to build without it.
 *
 * Why this exists — the failure it prevents (2026-08-23):
 * `NEXT_PUBLIC_SENTRY_DSN` is read at BUILD time in two places:
 *   - `next.config.js` wraps the app with Sentry only when it is set
 *   - `components/ErrorBoundary.tsx` reports a caught crash only when it is set
 * The mobile build never supplied it (the web image gets it as a Docker build
 * arg, guarded by `test/deployBuildArgs.test.ts`; the mobile build had no
 * equivalent). So every shipped APK/IPA contained no Sentry at all: zero events
 * from `app.jawab24.com` in 90 days, while the same code on the web reported
 * normally. A merchant hit the full-screen «حدث خطأ ما» boundary and we had no
 * stack, no route, and no count — the crash was invisible by construction.
 *
 * A missing value here cannot be repaired later: these are inlined into the
 * bundle at build time and baked into the APK. So this fails the build rather
 * than warning — a store release is the wrong place to discover the gap. There
 * is deliberately no opt-out flag: an escape hatch here recreates the exact
 * silence it is meant to end.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const frontendDir = path.join(__dirname, '..');
const repoRoot = path.join(frontendDir, '..');

/**
 * Files searched for a build-time variable, in precedence order. `.env.local`
 * is Next's own convention and is what a developer machine normally holds; the
 * repo-root `.env` is the file `docker-compose.yml` interpolates the frontend
 * image's build args from, so both builds can read one value.
 */
const ENV_FILES = [
  path.join(frontendDir, '.env.local'),
  path.join(repoRoot, '.env'),
];

/**
 * Reads one key out of a dotenv-style file. Deliberately minimal — it must not
 * pull a parser dependency into a script that runs before `next build`, and it
 * only ever looks for keys this file names.
 */
function readKeyFromEnvFile(file, key) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // absent file is a normal case, not an error
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip one matching pair of surrounding quotes, the only quoting form
    // these files use.
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

/**
 * Resolves a required build-time variable: the ambient environment wins, then
 * each env file in order. Returns `{ value, source }`, or `{ value: null }`
 * when nothing supplies it.
 *
 * An empty or whitespace-only value counts as MISSING. `${VAR:-}` in
 * docker-compose and a stray `KEY=` line both produce an empty string, and an
 * empty DSN disables Sentry just as completely as an absent one — treating it
 * as present is how a blind build passes a guard.
 */
function resolveBuildVar(key, { env = process.env, files = ENV_FILES } = {}) {
  const fromEnv = env[key];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { value: fromEnv, source: 'environment' };
  }
  for (const file of files) {
    const value = readKeyFromEnvFile(file, key);
    if (typeof value === 'string' && value.trim() !== '') {
      return { value, source: file };
    }
  }
  return { value: null, source: null };
}

/** Build-time variables the mobile bundle cannot be shipped without. */
const REQUIRED_VARS = ['NEXT_PUBLIC_SENTRY_DSN'];

/**
 * The full env for the mobile `next build`. `NEXT_PUBLIC_API_URL` points at
 * production because the bundle is baked into the store binary — it has no
 * runtime configuration of any kind.
 */
function mobileBuildEnv({ env = process.env, files = ENV_FILES, now = Date.now() } = {}) {
  const resolved = {};
  const missing = [];
  for (const key of REQUIRED_VARS) {
    const { value } = resolveBuildVar(key, { env, files });
    if (value === null) missing.push(key);
    else resolved[key] = value;
  }
  if (missing.length > 0) {
    const err = new Error(
      `Mobile build refused: ${missing.join(', ')} is not set.\n` +
      'These are inlined at BUILD time and baked into the APK/IPA — a missing\n' +
      'value cannot be supplied later, and produces a store binary that reports\n' +
      'no crashes at all.\n\n' +
      `Fix: add the value to ${ENV_FILES[0]} (or ${ENV_FILES[1]}), or export it\n` +
      'in the shell running this build, then re-run.',
    );
    err.missing = missing;
    throw err;
  }
  return {
    ...env,
    ...resolved,
    NEXT_PUBLIC_BUILD_TIME: String(now),
    NEXT_PUBLIC_API_URL: 'https://jawab24.com/api',
    NEXT_PUBLIC_PHONE_AUTH_ENABLED: 'true',
    IS_MOBILE_BUILD: 'true',
  };
}

function main() {
  let env;
  try {
    env = mobileBuildEnv();
  } catch (error) {
    console.error(`\n❌ ${error.message}\n`);
    process.exit(1);
  }

  // Names and provenance only — never the values. A DSN is not a secret the way
  // an API key is, but this script is the template for the next required var.
  for (const key of REQUIRED_VARS) {
    const { source } = resolveBuildVar(key);
    console.log(`✓ ${key} resolved from ${source}`);
  }

  execFileSync('npx', ['next', 'build'], { cwd: frontendDir, stdio: 'inherit', env });
}

if (require.main === module) main();

module.exports = { resolveBuildVar, mobileBuildEnv, readKeyFromEnvFile, REQUIRED_VARS, ENV_FILES };
