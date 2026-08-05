#!/bin/bash
# Isolation arm: remove ONE general rule from the demo KB and nothing else.
#
# The rule under test is the merchant's own cross-course default:
#   «معظم الدورات ٨ ساعات تدريبية مدتها شهر, يومين في الاسبوع, ساعة واحدة في اليوم, …»
# 8 hours at one hour per day is 8 sessions, so this single line is what lets a reply
# answer «كم جلسة؟» for a course whose row carries no session count. The question this
# arm answers: is that line load-bearing, or is the number coming from somewhere else?
#
# ⚠️ TWO TRAPS THIS SCRIPT EXISTS TO AVOID
#  1. `POST /auth/demo` RE-SEEDS the demo pages — seedDemoData writes
#     `knowledgeBase: pageData.suggestedKnowledgeBase` on every call. So minting a token
#     AFTER editing silently restores the KB and both arms end up identical. Mint first,
#     edit second, never re-mint before the run.
#  2. Editing with `regexp_replace(kb, '…[^\n]*', …)` does NOT work: in a standard
#     Postgres literal `\n` is backslash-and-n, not a newline. The text is computed in
#     TypeScript against the fixture instead, then loaded from a file.
set -e
cd "$(dirname "$0")/../.."
DB=${DB:-jawab24_verbatim_test}

npx tsx -e "
import { DAMASCUS_DEMO_KB } from './backend/src/plugins/demo/damascusKb';
import { writeFileSync } from 'fs';
const LINE = 'معظم الدورات ٨ ساعات تدريبية  مدتها شهر  , يومين في الاسبوع , ساعة واحدة في اليوم , السعر دائما لكامل الجلسات , و ليس لجلسة واحدة .';
if (!DAMASCUS_DEMO_KB.includes(LINE)) { console.error('rule line not found in fixture — abort'); process.exit(1); }
const out = DAMASCUS_DEMO_KB.replace(LINE + '\n', '');
if (out.includes('٨ ساعات تدريبية')) { console.error('rule still present after edit — abort'); process.exit(1); }
writeFileSync('/tmp/kb_stripped.txt', out);
console.error('stripped ' + (DAMASCUS_DEMO_KB.length - out.length) + ' chars');
"

psql -h localhost -p 5432 -U "$(whoami)" -d "$DB" -q <<SQL
\set kb \`cat /tmp/kb_stripped.txt\`
UPDATE pages SET knowledge_base = :'kb', kb_version = kb_version + 1
WHERE facebook_page_id = 'demo_page_damascus';
SQL

echo "--- verification (must print 0):"
psql -h localhost -p 5432 -U "$(whoami)" -d "$DB" -tAc \
  "SELECT count(*) FROM pages WHERE facebook_page_id='demo_page_damascus' AND knowledge_base LIKE '%٨ ساعات تدريبية%';"
psql -h localhost -p 5432 -U "$(whoami)" -d "$DB" -tAc \
  "SELECT length(knowledge_base), kb_version FROM pages WHERE facebook_page_id='demo_page_damascus';"
