#!/bin/bash
#
# Lists — and with --drop, removes — integration-test databases whose checkout is gone.
#
#   npm run prune:test-dbs           # report only (safe, the default)
#   npm run prune:test-dbs -- --drop # actually drop the orphans
#
# WHY THIS EXISTS
# ---------------
# Each checkout that runs the integration suite gets its own database
# (scripts/test-db-url.sh) of roughly 16 MB. That is what makes concurrent runs
# safe, but deleting a worktree does not delete its database, and this host
# routinely carries 100+ worktrees — so without a reaper the isolation fix trades
# a correctness bug for an unbounded disk leak.
#
# The database NAME carries a hash of the checkout path, not the path, so it
# cannot be reversed. backend/test/integration/globalSetup.ts therefore records
# the owning checkout in the database's COMMENT, and this script drops the ones
# whose recorded path no longer exists. Databases created before that (or by the
# deploy gate, which does not comment) have no owner recorded and are reported
# as unknown rather than dropped — never guess when the answer is "drop a database".
#
# Overrides: TEST_PG_HOST (default localhost), TEST_PG_PORT (default 5433).
set -euo pipefail

PG_HOST="${TEST_PG_HOST:-localhost}"
PG_PORT="${TEST_PG_PORT:-5433}"
DROP=false
case "${1:-}" in
    --drop) DROP=true ;;
    "") ;;
    *) echo "usage: prune-test-dbs.sh [--drop]"; exit 2 ;;
esac

psql_q() { PGPASSWORD=postgres psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }

if ! pg_isready -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null; then
    echo "❌ Postgres is not reachable on ${PG_HOST}:${PG_PORT}"
    exit 1
fi

# datname <TAB> owning checkout path ('' when none was recorded)
ROWS="$(psql_q -tAF $'\t' -c "
    SELECT d.datname,
           coalesce(shobj_description(d.oid, 'pg_database'), '')
    FROM pg_database d
    WHERE d.datname LIKE 'autoreply\_test%'
    ORDER BY d.datname
")"

if [[ -z "$ROWS" ]]; then
    echo "✅ No integration-test databases on ${PG_HOST}:${PG_PORT}"
    exit 0
fi

ORPHANS=()
printf '%-52s %10s  %s\n' "DATABASE" "SIZE" "OWNING CHECKOUT"
while IFS=$'\t' read -r NAME OWNER; do
    [[ -z "$NAME" ]] && continue
    SIZE="$(psql_q -tAc "SELECT pg_size_pretty(pg_database_size('${NAME}'))")"
    if [[ -z "$OWNER" ]]; then
        # No recorded owner: either created by the deploy gate (which does not
        # comment) before the suite ran, or the bare pre-2026-08-09 `autoreply_test`
        # reappearing because some checkout still predates the per-checkout change.
        # Report, never drop — an unattributed database is exactly the case where
        # guessing is how you delete something that mattered.
        STATUS="❓ unknown owner — not dropped (run the suite once to record it)"
    elif [[ -d "$OWNER" ]]; then
        STATUS="✅ live — $OWNER"
    else
        STATUS="🗑  ORPHAN — $OWNER is gone"
        ORPHANS+=("$NAME")
    fi
    printf '%-52s %10s  %s\n' "$NAME" "$SIZE" "$STATUS"
done <<< "$ROWS"

echo ""
if [[ ${#ORPHANS[@]} -eq 0 ]]; then
    echo "✅ Nothing to prune."
    exit 0
fi

if [[ "$DROP" != true ]]; then
    echo "${#ORPHANS[@]} orphan(s) found. Re-run with --drop to remove them:"
    echo "   npm run prune:test-dbs -- --drop"
    exit 0
fi

for NAME in "${ORPHANS[@]}"; do
    # No WITH (FORCE): a blocked DROP means something is still attached, and
    # force-terminating another session's suite is exactly the failure mode this
    # whole per-checkout scheme exists to prevent.
    if psql_q -q -c "DROP DATABASE IF EXISTS \"${NAME}\""; then
        echo "🗑  Dropped ${NAME}"
    else
        echo "⚠️  Could not drop ${NAME} — something is still connected to it. Skipped."
    fi
done
