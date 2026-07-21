#!/bin/bash
# Compare LIVE production column defaults against the latest Drizzle snapshot.
#
# Why this exists (2026-07-21): `settings.timezone` was created by migration 0026
# with DEFAULT 'Asia/Damascus', but production had been serving 'Asia/Riyadh' —
# someone had ALTERed it by hand, with no migration and no trace. Every merchant
# who never opened Settings inherited a timezone nobody chose, and because
# business hours are evaluated in it, one merchant's evening traffic went
# unanswered for an hour a day.
#
# check-schema-drift.sh cannot catch this: it diffs schema.ts against the
# migration snapshots, and both agreed. Only the live database disagreed. This
# script closes that gap by reading `information_schema` from prod and comparing
# it to what the migration history says the defaults should be.
#
# Read-only — it issues a single SELECT via scripts/prod-db-query.sh.
#
# Usage: ./scripts/check-live-column-defaults.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
META_DIR="$REPO_ROOT/backend/migrations/meta"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 Comparing live column defaults against the latest migration snapshot..."

# The live rows go to a temp FILE, not a pipe: `python3 -` takes its program from
# stdin, so piping the data in as well would leave the program reading an
# already-consumed stdin — zero rows parsed, zero mismatches found, and a green
# check that verifies nothing. (Caught exactly that way while writing this.)
LIVE_FILE="$(mktemp)"
trap 'rm -f "$LIVE_FILE"' EXIT

"$SCRIPT_DIR/prod-db-query.sh" "SELECT table_name || '|' || column_name || '|' || coalesce(column_default, '') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name;" > "$LIVE_FILE"

python3 - "$META_DIR" "$LIVE_FILE" <<'PY'
import json, os, re, sys

meta_dir = sys.argv[1]
snapshots = sorted(f for f in os.listdir(meta_dir) if f.endswith('_snapshot.json'))
if not snapshots:
    sys.exit("No Drizzle snapshots found — is backend/migrations/meta populated?")
snapshot = json.load(open(os.path.join(meta_dir, snapshots[-1])))

# psql -x prints "col | value"; we asked for one packed column, so pull the RHS.
live = {}
for line in open(sys.argv[2]):
    if '|' not in line:
        continue
    packed = line.split('|', 1)[1].strip()
    parts = packed.split('|')
    if len(parts) != 3:
        continue
    table, column, default = parts
    live[(table, column)] = default.strip()

# A green check on an empty parse would be a lie, not a pass.
if not live:
    sys.exit("Parsed 0 columns from the live database — refusing to report a pass.")


# Postgres and Drizzle spell the same default differently. Every one of these
# would otherwise report as drift on a healthy database, and a check that cries
# wolf on nine benign rows to flag one real one gets muted — so equivalences are
# normalized away deliberately, and only genuine value differences survive.
EQUIVALENT = {
    # Prod generates UUIDs via the uuid-ossp extension; Drizzle emits pgcrypto's
    # spelling. Same value space, no behavioural difference.
    'uuid_generate_v4()': 'gen_random_uuid()',
}


def normalize(value):
    """Compare defaults by VALUE, not by how Postgres chose to spell them."""
    if value is None:
        return ''
    # Snapshot defaults are typed: numbers/booleans come through as int/bool,
    # so Python renders them "True"/"False" against Postgres's "true"/"false".
    value = str(value).strip()
    # Strip EVERY inline cast, not just a trailing one: an array default reads
    # "ARRAY['en'::text, 'ar'::text]" and anchoring to the end would truncate it
    # mid-value and report a false mismatch.
    value = re.sub(r'::[a-zA-Z][a-zA-Z ]*(\[\])?', '', value)
    # JSON/array literals differ only by spacing between the two writers.
    value = re.sub(r'\s+', '', value)
    value = value.lower() if value.lower() in ('true', 'false') else value
    return EQUIVALENT.get(value, value)


mismatches = []
for table_name, table in snapshot.get('tables', {}).items():
    real_table = table.get('name', table_name)
    for column in table.get('columns', {}).values():
        expected = normalize(column.get('default'))
        # Columns the snapshot says have no default are out of scope: a live
        # default that the migrations never declared is usually an intentional
        # DBA-side backfill guard, and flagging every one of them is noise.
        if not expected:
            continue
        key = (real_table, column['name'])
        if key not in live:
            continue  # column not in prod yet — that is migration drift, not default drift
        actual = normalize(live[key])
        if actual != expected:
            mismatches.append((real_table, column['name'], expected, actual))

if mismatches:
    print("")
    print("\033[0;31m❌ LIVE DEFAULT DRIFT DETECTED\033[0m")
    print("")
    print("These columns have a DEFAULT in production that the migration history never set.")
    print("Someone almost certainly ALTERed the live database by hand.")
    print("")
    for table, column, expected, actual in mismatches:
        print(f"  {table}.{column}")
        print(f"    migrations say : {expected}")
        print(f"    production has : {actual}")
    print("")
    print("\033[1;33mFix by deciding which value is correct, then writing a migration for it —\033[0m")
    print("\033[1;33mnever by ALTERing production directly.\033[0m")
    sys.exit(1)

print("\033[0;32m✅ Live column defaults match the migration snapshot\033[0m")
PY
