/**
 * Regression tests for scripts/lib/build-lock.sh.
 *
 * Run: node --test scripts/__tests__/build-lock.test.mjs
 *
 * scripts/pre-deploy-check.sh (production build) and scripts/release-android.sh
 * (mobile build) BOTH build into frontend/.next, and both begin with
 * `rm -rf .next`. `.next-mobile` is only the mobile build's export output — its
 * BUILD_ID, server/, static/ and types/ land in `.next` like any other build.
 * So either script, started while the other is running, deletes the other's
 * build directory mid-flight and corrupts BOTH runs.
 *
 * This happened on 2026-08-22: an Android release started ~2 minutes into a
 * deploy-production.sh run died with
 *   ENOENT: rename '.next/export/invites/accept.html'
 *        -> '.next/server/pages/invites/accept.html'
 * an error that names neither script. The gate's own lock could not help — it
 * was only ever taken by pre-deploy-check.sh, and release-android.sh took none.
 *
 * The mutual-exclusion test is the one that would have caught it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK_SH = join(REPO_ROOT, 'scripts', 'lib', 'build-lock.sh');

/**
 * Run a bash snippet with the helper sourced from a THROWAWAY copy of the repo
 * layout, so a test can never touch the real checkout's lock. The helper derives
 * the lock path from its own location (../../ from scripts/lib), which is
 * precisely the property that keeps it pinned to the owning checkout.
 */
function runInSandbox(snippet, { sandbox } = {}) {
  const root = sandbox ?? mkdtempSync(join(tmpdir(), 'build-lock-'));
  const libDir = join(root, 'scripts', 'lib');
  mkdirSync(libDir, { recursive: true });
  writeFileSync(join(libDir, 'build-lock.sh'), execFileSync('cat', [LOCK_SH]));

  // Merge stderr into stdout: the refusal message is written to stderr (it is a
  // diagnostic, not output), and a test that only read stdout would call the
  // refusal correct while its message was blank.
  const script = `set -uo pipefail\nexec 2>&1\nsource "${join(libDir, 'build-lock.sh')}"\n${snippet}`;
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    status = err.status ?? 1;
    stdout = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  return { root, stdout, status, lockDir: join(root, '.frontend-build.lock') };
}

test('acquires the lock and reports the holder pid and label', () => {
  const { lockDir, status } = runInSandbox(`
    acquire_frontend_build_lock "pre-deploy check"
    cat "$FRONTEND_BUILD_LOCK_DIR/pid" "$FRONTEND_BUILD_LOCK_DIR/label"
  `);
  assert.equal(status, 0);
  assert.ok(existsSync(lockDir), 'lock directory must exist after acquire');
});

test('a second acquire is REFUSED while the holder is alive', () => {
  // The holder is a live background process, exactly like a running deploy.
  const { stdout, status } = runInSandbox(`
    sleep 30 &
    holder=$!
    mkdir "$FRONTEND_BUILD_LOCK_DIR"
    echo $holder > "$FRONTEND_BUILD_LOCK_DIR/pid"
    echo "pre-deploy check" > "$FRONTEND_BUILD_LOCK_DIR/label"

    acquire_frontend_build_lock "android release" && echo "ACQUIRED"
    echo "exit=$?"
    kill $holder 2>/dev/null
  `);
  assert.doesNotMatch(stdout, /ACQUIRED/, 'must not acquire a lock held by a live process');
  assert.match(stdout, /exit=1/, 'must signal failure to the caller');
  assert.match(stdout, /Already running in this checkout: pre-deploy check/, 'must name WHAT holds the lock');
  assert.equal(status, 0);
});

test('a stale lock (holder no longer running) is reclaimed', () => {
  // PID 2^31-1 is guaranteed not to be running; this is the crashed-run case.
  const { stdout } = runInSandbox(`
    mkdir "$FRONTEND_BUILD_LOCK_DIR"
    echo 2147483647 > "$FRONTEND_BUILD_LOCK_DIR/pid"
    echo "android release" > "$FRONTEND_BUILD_LOCK_DIR/label"

    acquire_frontend_build_lock "pre-deploy check" && echo "ACQUIRED"
    cat "$FRONTEND_BUILD_LOCK_DIR/label"
  `);
  assert.match(stdout, /Reclaiming a stale lock/);
  assert.match(stdout, /ACQUIRED/, 'a stale lock must not block a new run forever');
  assert.match(stdout, /pre-deploy check/, 'the reclaiming run must become the recorded holder');
});

test('release removes the lock, letting the next run start', () => {
  const { stdout, lockDir } = runInSandbox(`
    acquire_frontend_build_lock "android release"
    release_frontend_build_lock
    acquire_frontend_build_lock "pre-deploy check" && echo "REACQUIRED"
  `);
  assert.match(stdout, /REACQUIRED/);
  assert.ok(existsSync(lockDir), 'the second acquire re-creates the lock');
});

test('the lock path is pinned to the owning checkout, not the caller cwd', () => {
  // A release script cd's around; the lock must still be the repo's own.
  const elsewhere = mkdtempSync(join(tmpdir(), 'build-lock-cwd-'));
  const { root, lockDir } = runInSandbox(`
    cd "${elsewhere}"
    acquire_frontend_build_lock "android release"
    echo "$FRONTEND_BUILD_LOCK_DIR"
  `);
  assert.equal(lockDir, join(root, '.frontend-build.lock'));
  assert.ok(!existsSync(join(elsewhere, '.frontend-build.lock')), 'must not lock the caller cwd');
  rmSync(elsewhere, { recursive: true, force: true });
});

test('both build entry points take the lock', () => {
  // The 2026-08-22 collision was possible because only ONE of them did.
  for (const script of ['pre-deploy-check.sh', 'release-android.sh']) {
    const src = execFileSync('cat', [join(REPO_ROOT, 'scripts', script)], { encoding: 'utf8' });
    assert.match(src, /source .*scripts\/lib\/build-lock\.sh/, `${script} must source the helper`);
    assert.match(src, /acquire_frontend_build_lock /, `${script} must acquire the lock`);
    assert.match(src, /trap .*release_frontend_build_lock/, `${script} must release it on exit`);
  }
});
