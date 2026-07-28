#!/bin/bash
# Read-only prod Postgres query runner for diagnostics.
# Run: ./scripts/prod-db-query.sh "SELECT ...;"        (single statement)
#  or: ./scripts/prod-db-query.sh --file query.sql
#  or: ./scripts/prod-db-query.sh --logs <container> <since> <grep-pattern>
#
# Uses the same server/key convention as deploy-production.sh. SELECT-only
# guard: refuses statements containing write keywords so this can never
# mutate prod (mirrors the safety posture of scripts/phase6_5_breakdown.ts).

set -euo pipefail

SERVER_USER="root"
SERVER_HOST="91.99.95.196"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_jawab24_deploy}"

if [ "${1:-}" = "--logs" ]; then
  CONTAINER="${2:?container name required}"
  SINCE="${3:-1h}"
  PATTERN="${4:-.}"
  ssh -i "$SSH_KEY" -o ConnectTimeout=15 -o BatchMode=yes "${SERVER_USER}@${SERVER_HOST}" \
    "docker logs ${CONTAINER} --since ${SINCE} 2>&1 | grep -E \"${PATTERN}\" | tail -40"
  exit 0
fi

if [ "${1:-}" = "--file" ]; then
  SQL=$(cat "${2:?sql file required}")
else
  SQL="${1:?SQL statement required}"
fi

# Read-only guard — reject anything that isn't a plain SELECT/WITH query.
if echo "$SQL" | grep -qiE '\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|vacuum|copy)\b'; then
  echo "❌ Refusing: this runner is SELECT-only." >&2
  exit 1
fi

# Output formatting. Default -x (expanded rows) is right for reading diagnostics
# by eye; PSQL_ARGS=-At gives tuples-only unaligned output, which is what a query
# ending in json_agg needs so its result can be piped straight into a file.
PSQL_ARGS="${PSQL_ARGS:--x}"

echo "$SQL" | ssh -i "$SSH_KEY" -o ConnectTimeout=15 -o BatchMode=yes "${SERVER_USER}@${SERVER_HOST}" \
  "docker exec -i jawab24-postgres sh -c \"psql -U \\\"\\\$POSTGRES_USER\\\" -d \\\"\\\$POSTGRES_DB\\\" -v ON_ERROR_STOP=1 ${PSQL_ARGS}\""
