#!/bin/bash
# The measurement arms (plan §4 decision 1, §5 item 6) — one arm per run.
#
#   ARM=A  ./scripts/local/arms-battery.sh     # today's state
#   ARM=B1 ./scripts/local/arms-battery.sh     # data separation alone
#   ARM=B3 ./scripts/local/arms-battery.sh     # B1 + directive ENFORCEMENT
#
# ⚠️ WHERE IS B2? The plan lists «B2 = B1 + الفحص الحتمي» as its own arm. It is
# NOT a separable arm, and the reason is the design's core safety property: the
# deterministic checks (date_not_in_source, stale_date, directive_ignored) are
# ADDITIVE — they append a flag and block caching, and never remove a sentence
# or change a reply. So B1 and B2 would emit byte-identical replies, and running
# both would burn ~150 generations to measure nothing.
# What B2 was meant to measure is DETECTION, and this script reports it on every
# arm: the per-class flag counts below ARE the deterministic judge's firing rate.
# Reported instead of faked, so nobody later reads a 4-arm table where two arms
# were identical by construction.
#
# ⚠️ TRAP 6, PAID FOR ONCE ALREADY: `POST /auth/demo` RE-SEEDS the demo pages on
# every call. The arm's fixture shape is chosen by DEMO_DAMASCUS_FIXTURE, which
# the BACKEND reads at seed time — so the backend must be restarted with the
# arm's env BEFORE the token is minted. Minting first and editing after silently
# restores the other arm's data; that invalidated a whole isolation run.
set -euo pipefail
cd "$(dirname "$0")/../.."

ARM=${ARM:-A}
REPS=${REPS:-3}
PORT=${PORT:-3100}
DB=${DB:-jawab24_verbatim_test}
OUT=${OUT:-/tmp/arm-${ARM}.jsonl}

case "$ARM" in
  A)  FIXTURE=current;   ENFORCE=off ;;
  B1) FIXTURE=separated; ENFORCE=off ;;
  B3) FIXTURE=separated; ENFORCE=on  ;;
  B2) echo "❌ B2 is not a separable arm — see the header. Use B1 and read its flag counts." >&2; exit 2 ;;
  *)  echo "❌ Unknown ARM=$ARM (expected A | B1 | B3)" >&2; exit 2 ;;
esac

echo "━━━ ARM=$ARM  fixture=$FIXTURE  enforcement=$ENFORCE  reps=$REPS"
echo
echo "PRECONDITIONS — this script does NOT restart your servers, on purpose:"
echo "  1. backend on :$PORT started with DEMO_DAMASCUS_FIXTURE=$FIXTURE"
echo "  2. ai-worker on :3005 started with DIRECTIVE_ENFORCEMENT=$ENFORCE"
echo "  3. THEN mint the token (re-seeds the demo pages with this arm's fixture):"
echo "       curl -s -XPOST localhost:$PORT/auth/demo -H 'Content-Type: application/json' -d '{}' > /tmp/demo.json"
echo "  4. one-time: psql -d $DB -c \"UPDATE users SET is_admin=true WHERE email='demo@jawab24.com';\""
echo

# Refuse to measure the wrong arm: prove the seeded page matches the fixture.
CURRICULUM_ROWS=$(psql -h localhost -p 5432 -U "$(whoami)" -d "$DB" -tAc \
  "SELECT count(*) FROM fact_rows r JOIN fact_collections c ON c.id=r.collection_id
   JOIN pages p ON p.id=c.page_id
   WHERE p.facebook_page_id='demo_page_damascus' AND c.label='محاور الدورات';" 2>/dev/null || echo "ERR")
DIRECTIVES=$(psql -h localhost -p 5432 -U "$(whoami)" -d "$DB" -tAc \
  "SELECT coalesce(jsonb_array_length(business_profile->'merchant'->'directives'),0)
   FROM pages WHERE facebook_page_id='demo_page_damascus';" 2>/dev/null || echo "ERR")

echo "seeded state: محاور rows=$CURRICULUM_ROWS  directives=$DIRECTIVES"
if [ "$FIXTURE" = "separated" ] && { [ "$CURRICULUM_ROWS" = "0" ] || [ "$DIRECTIVES" = "0" ]; }; then
  echo "❌ ARM=$ARM expects the SEPARATED fixture, but the DB holds the current one." >&2
  echo "   Restart the backend with DEMO_DAMASCUS_FIXTURE=separated and re-mint the token." >&2
  exit 1
fi
if [ "$FIXTURE" = "current" ] && [ "$CURRICULUM_ROWS" != "0" ]; then
  echo "❌ ARM=A expects the CURRENT fixture, but the separated one is seeded." >&2
  exit 1
fi

# Enforcement lives in the AI-WORKER's launch env, which is invisible from here —
# so ASSERT it rather than trusting the precondition text above. A B1 run against a
# worker still carrying B3's enforcement produced a mislabelled result once already.
WORKER_ENFORCE=$(curl -s -m 5 localhost:3005/health | python3 -c \
  "import json,sys; print(json.load(sys.stdin).get('directiveEnforcement'))" 2>/dev/null || echo "UNREACHABLE")
echo "ai-worker enforcement=$WORKER_ENFORCE (arm needs $ENFORCE)"
case "$WORKER_ENFORCE:$ENFORCE" in
  True:on|False:off) ;;
  UNREACHABLE:*) echo "❌ ai-worker on :3005 is not reachable — start it first." >&2; exit 1 ;;
  None:*) echo "❌ ai-worker predates the enforcement health field — restart it from THIS worktree." >&2; exit 1 ;;
  *) echo "❌ ai-worker enforcement=$WORKER_ENFORCE but ARM=$ARM needs $ENFORCE." >&2
     echo "   Restart it: DIRECTIVE_ENFORCEMENT=$ENFORCE ./scripts/local/start-aiworker.sh" >&2; exit 1 ;;
esac

TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/demo.json'))['token'])")
PAGE=$(psql -h localhost -p 5432 -U "$(whoami)" -d "$DB" -tAc \
  "SELECT id FROM pages WHERE facebook_page_id='demo_page_damascus';")
: > "$OUT"

# `source: 'eval'` bypasses every cache, so each run is a fresh generation at
# production sampling — and flags come straight from THIS worktree's validator.
python3 - "$TOKEN" "$PAGE" "$REPS" "$OUT" "$ARM" "$PORT" <<'PY'
import json, sys, urllib.request

token, page, reps, out, arm, port = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5], sys.argv[6]
corpus = json.load(open('scripts/local/damascus-questions.json'))['questions']

with open(out, 'a', encoding='utf-8') as fh:
    for rep in range(1, reps + 1):
        for item in corpus:
            body = json.dumps({'pageId': page, 'question': item['q'],
                               'channel': 'dm', 'source': 'eval'}).encode()
            req = urllib.request.Request(
                f'http://localhost:{port}/admin/ai/playground', data=body,
                headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    d = json.loads(r.read().decode())
                    d = d.get('data', d)
                row = {'arm': arm, 'cls': item['class'], 'rep': rep, 'q': item['q'],
                       'reply': d.get('reply') or '', 'flags': d.get('flags') or [],
                       'intent': d.get('intent')}
            except Exception as e:
                # A hard failure counted as "clean" would flatter the result.
                row = {'arm': arm, 'cls': item['class'], 'rep': rep, 'q': item['q'],
                       'reply': '', 'flags': ['REQUEST_FAILED'], 'error': str(e)[:200]}
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')
            print('.', end='', flush=True)
print()
PY

echo
echo "━━━ ARM=$ARM per-class flags (this IS the deterministic judge's detection rate)"
python3 - "$OUT" <<'PY'
import json, sys, collections
rows = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8')]
per = collections.defaultdict(lambda: collections.Counter())
totals = collections.Counter()
for r in rows:
    totals[r['cls']] += 1
    for f in r['flags']:
        per[r['cls']][f] += 1
    if not r['reply']:
        per[r['cls']]['(empty reply)'] += 1
for cls in sorted(totals):
    flags = per[cls]
    detail = ', '.join(f'{k}={v}' for k, v in sorted(flags.items())) or 'clean'
    print(f'  {cls:<20} n={totals[cls]:<3} {detail}')
failed = sum(1 for r in rows if 'REQUEST_FAILED' in r['flags'])
if failed:
    print(f'\n  ⚠️  {failed} request(s) FAILED — re-run before quoting any rate.')
print(f'\nwrote {len(rows)} replies to {sys.argv[1]}')
PY
