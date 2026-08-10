#!/bin/bash
#
# Prints the Postgres URL of THIS checkout's integration-test database.
#
# Single source of truth: scripts/pre-deploy-check.sh and backend's
# `test:integration:local` both call this script, so the deploy gate and a
# hand-run suite can never disagree about which database they are using.
#
# WHY THE NAME IS PER-CHECKOUT (2026-08-09)
# -----------------------------------------
# `autoreply_test` used to be ONE machine-global database shared by the main
# checkout and every worktree (115 of them on this machine at the time).
# backend/test/integration/setup.ts TRUNCATEs ~20 tables before EVERY test, so
# two suites running at once delete each other's fixtures. That cost a full
# investigation of a "failing" deploy gate:
#
#   * A gate run in the main checkout overlapped a bare
#     `npm run test:integration:local` in another worktree. The gate reported 29
#     failures across 13 files that had nothing to do with the code — rows
#     vanishing mid-test, ending in a foreign-key violation on
#     workspaces.owner_id because `users` had just been truncated by the other
#     run. A false red, twice over.
#   * An earlier gate run died outright in the drop/create step: Postgres
#     refuses DROP DATABASE while another session is connected to it.
#
# Deriving the name from the checkout path makes the collision IMPOSSIBLE rather
# than merely detected (AI_INSTRUCTIONS Rule 14, prevention over detection).
#
# A lock would NOT have fixed this. The gate's own lock is per-checkout, and the
# competing run was a bare `npm run test:integration:local`, which takes no gate
# lock at all. Isolating the resource is the only fix that covers both entry
# points. Note also that `DROP DATABASE ... WITH (FORCE)` is the WRONG fix here:
# it would let one run succeed by force-terminating another run's connections,
# turning a visible failure into silent sabotage of someone else's suite.
#
# Overrides:
#   TEST_DATABASE_URL  — bypasses this script entirely (see backend/package.json).
#                        NOT unrestricted: the database it names must still satisfy
#                        scripts/testDatabaseName.mjs (`^autoreply_test[a-z0-9_]*$`),
#                        because that is the rule standing between the suite's
#                        per-test TRUNCATE and, say, the dev database. Point it at
#                        another `autoreply_test*` database, not an arbitrary one.
#   TEST_PG_HOST       — Postgres host (default localhost)
#   TEST_PG_PORT       — Postgres port (default 5433, the dev Docker container)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

PG_HOST="${TEST_PG_HOST:-localhost}"
PG_PORT="${TEST_PG_PORT:-5433}"

# A readable label (which checkout is this?) plus a hash of the absolute path
# (uniqueness). Two worktrees can share a basename; they cannot share a path.
# Postgres caps identifiers at 63 bytes — this stays well under that.
# Truncate FIRST, then strip a trailing separator: doing it the other way round
# lets the 24-char cut re-introduce one and emit `autoreply_test_foo__<hash>`.
LABEL="$(printf '%s' "$(basename "$REPO_ROOT")" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_')"
LABEL="${LABEL:0:24}"
LABEL="${LABEL%_}"

if command -v shasum > /dev/null 2>&1; then
    HASH="$(printf '%s' "$REPO_ROOT" | shasum -a 256 | cut -c1-10)"
else
    HASH="$(printf '%s' "$REPO_ROOT" | sha256sum | cut -c1-10)"
fi

# A checkout whose basename has no alphanumerics at all (`...`) leaves LABEL empty;
# skip the separator rather than emitting `autoreply_test__<hash>`.
if [[ -n "$LABEL" ]]; then
    DB_NAME="autoreply_test_${LABEL}_${HASH}"
else
    DB_NAME="autoreply_test_${HASH}"
fi

echo "postgresql://postgres:postgres@${PG_HOST}:${PG_PORT}/${DB_NAME}"
