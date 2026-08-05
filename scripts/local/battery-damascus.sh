#!/bin/bash
# Local battery on demo_page_damascus — REAL customer questions, mined from his own
# production traffic (412 matched the measured defect classes; these are stratified
# across them, plus two controls).
#
# `source: 'eval'` bypasses every cache, so each run is a fresh generation at production
# sampling. Flags come straight from validateReply in THIS worktree's ai-worker, which is
# what makes the new guards observable without a second judge.
set -e
TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/demo.json'))['token'])")
PAGE=$(psql -h localhost -p 5432 -U aliahdab -d jawab24_verbatim_test -tAc \
  "SELECT id FROM pages WHERE facebook_page_id='demo_page_damascus';")
REPS=${REPS:-2}
OUT=${OUT:-/tmp/battery-out.jsonl}
: > "$OUT"

# class|question   — every question is verbatim from his production inbox.
QUESTIONS=(
  "date|ايمت تبدأ دورة التصوير الفوتوغرافي؟"
  "date|طيب ايمت بتبدأ دوره"
  "date|ايمت تبدأ لدورة"
  "sessions|كم عدد الجلسات"
  "sessions|ممكن اعرف كم جلسه دوره العمل المخبري"
  "duration|كم مدة الدورة"
  "duration|وكم يوم وبتخلص الدوره؟"
  "content|شو محتوى الدورة؟"
  "content|شو بتعلم فيها"
  "tools|دورة الميكاب لازم جيب ادواتي معي؟"
  "directive|وبتعلمو تحليلات جوا بالمخبر ؟"
  "directive|وفي تعليم لسحب الدم؟"
  "control_absent|هل يوجد دورة خياطة"
  "control_price|قديش سعر دورة التمريض؟"
)

for rep in $(seq 1 "$REPS"); do
  for entry in "${QUESTIONS[@]}"; do
    cls="${entry%%|*}"; q="${entry#*|}"
    body=$(python3 -c "
import json,sys
print(json.dumps({'pageId':sys.argv[1],'question':sys.argv[2],'channel':'dm','source':'eval'}))
" "$PAGE" "$q")
    resp=$(curl -s -X POST http://localhost:3100/admin/ai/playground \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$body")
    python3 -c "
import json,sys
raw=sys.argv[1]
try:
    d=json.loads(raw); d=d.get('data',d)
except Exception:
    d={'reply':'','flags':['PARSE_ERROR'],'raw':raw[:200]}
print(json.dumps({'cls':sys.argv[2],'rep':int(sys.argv[3]),'q':sys.argv[4],
                  'reply':d.get('reply') or '','flags':d.get('flags') or [],
                  'intent':d.get('intent')}, ensure_ascii=False))
" "$resp" "$cls" "$rep" "$q" >> "$OUT"
    printf '.'
  done
done
echo
echo "wrote $(wc -l < "$OUT") replies to $OUT"
