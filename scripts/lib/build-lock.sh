#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Exclusive lock for anything that builds into frontend/.next
# ═══════════════════════════════════════════════════════════════════
# Sourced, never executed. Two entry points build the frontend in this
# checkout — scripts/pre-deploy-check.sh (production build) and
# scripts/release-android.sh (mobile build) — and BOTH use frontend/.next
# as their build directory. `.next-mobile` is only the mobile build's
# export OUTPUT (see frontend/.next/export-detail.json → outDirectory);
# the BUILD_ID, server/, static/ and types/ of a mobile build all land in
# `.next`, exactly like a production build. Both build scripts also begin
# with `rm -rf .next`.
#
# So a run of either script deletes the other's build directory mid-flight.
# Observed both ways:
#   - two pre-deploy runs (2026-07-28) → "Could not find a production build
#     in the '.next' directory" (next-export-no-build-id)
#   - an Android release started during a deploy (2026-08-22) → "ENOENT:
#     rename '.next/export/…html' -> '.next/server/pages/…html'"
# Neither error names the real cause, and BOTH runs are corrupted, so the
# damage reads as a false red in whichever one you happen to look at.
#
# distDir isolation (PR #310) cured dev-vs-build because those are different
# modes; it cannot help here — these are two production-mode builds and they
# share `.next` by definition. Refusing to start while another holds the lock
# is the only structural fix. mkdir is atomic on every POSIX filesystem,
# which is why it is used instead of flock (macOS has none).
#
# Usage:
#   source "$ROOT_DIR/scripts/lib/build-lock.sh"
#   acquire_frontend_build_lock "android release"
#   trap 'release_frontend_build_lock' EXIT INT TERM
#
# The caller owns its own trap so it can sweep its own temp files in the
# same handler; this file never installs one (a second `trap` would silently
# replace the caller's).

# Absolute path of the lock, derived from THIS file's location so it is always
# the checkout that owns the scripts — never the caller's $PWD.
FRONTEND_BUILD_LOCK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.frontend-build.lock"

# acquire_frontend_build_lock <label>
# <label> names the current run ("pre-deploy check", "android release") and is
# reported to whoever collides with it next.
acquire_frontend_build_lock() {
    local label="${1:-frontend build}"
    local _red="${RED:-\033[0;31m}" _yellow="${YELLOW:-\033[1;33m}" _nc="${NC:-\033[0m}"

    if ! mkdir "$FRONTEND_BUILD_LOCK_DIR" 2>/dev/null; then
        local held_pid held_label
        held_pid=$(cat "$FRONTEND_BUILD_LOCK_DIR/pid" 2>/dev/null || true)
        held_label=$(cat "$FRONTEND_BUILD_LOCK_DIR/label" 2>/dev/null || echo "another frontend build")

        if [ -n "$held_pid" ] && kill -0 "$held_pid" 2>/dev/null; then
            echo -e "${_red}❌ Already running in this checkout: ${held_label} (PID ${held_pid}).${_nc}" >&2
            echo -e "${_red}   Both build into frontend/.next and each one's 'rm -rf .next' would${_nc}" >&2
            echo -e "${_red}   destroy the other's build directory — corrupting BOTH runs.${_nc}" >&2
            echo -e "${_yellow}   Wait for it to finish, or stop it:  kill ${held_pid}${_nc}" >&2
            return 1
        fi
        echo -e "${_yellow}⚠️  Reclaiming a stale lock (PID ${held_pid:-unknown} is no longer running)${_nc}"
    fi

    echo $$ > "$FRONTEND_BUILD_LOCK_DIR/pid"
    printf '%s\n' "$label" > "$FRONTEND_BUILD_LOCK_DIR/label"
}

release_frontend_build_lock() {
    rm -rf "$FRONTEND_BUILD_LOCK_DIR"
}
