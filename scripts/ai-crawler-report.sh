#!/usr/bin/env bash
#
# Weekly AI-assistant / search-bot reach report, from the nginx access log.
#
# Answers "do AI tools fetch us, and what?" with a count rather than an estimate
# (SEO_ACTIONS_2026-08-07.md §9.1). nginx logs to the container's stdout, so the
# source is `docker logs`; docker-compose.yml keeps 50m × 14 files (≈ a month),
# which is what makes a 7-day window readable at all — the previous 10m × 3 held
# about two days and was wiped on every `--force-recreate`.
#
# Usage:  ./scripts/ai-crawler-report.sh              # last 7 days
#         CRAWLER_WINDOW=48h ./scripts/ai-crawler-report.sh
#
# Cron example (Mondays 04:00, appended so weeks can be compared):
#   0 4 * * 1 cd /var/www/jawab24 && ./scripts/ai-crawler-report.sh >> /var/log/jawab24-crawlers.log 2>&1
#
# Exit code is always 0: a report is an observation, never a gate.

set -uo pipefail

WINDOW="${CRAWLER_WINDOW:-168h}"
CONTAINER="${NGINX_CONTAINER:-jawab24-nginx}"
TOP_PATHS="${CRAWLER_TOP_PATHS:-40}"

# Assistant / AI crawlers first, then the two search bots for scale. The UA
# match is case-insensitive; the label printed is the canonical spelling.
AGENTS='ChatGPT-User|OAI-SearchBot|GPTBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Google-Extended|meta-externalagent|CCBot|Bytespider|Amazonbot|Applebot|YouBot|DuckAssistBot|cohere-ai|bingbot|Googlebot'

if ! command -v docker >/dev/null 2>&1; then
    echo "docker not available — nothing to report"
    exit 0
fi

LOG="$(docker logs --since "$WINDOW" "$CONTAINER" 2>&1)" || {
    echo "could not read logs for container $CONTAINER"
    exit 0
}

echo "=== AI-crawler report  generated $(date -u +%FT%TZ)  window=$WINDOW  container=$CONTAINER"
# The window is only as deep as the log retention — print the first line's
# timestamp so a short retention is visible instead of silently reading as
# "low traffic".
first="$(printf '%s\n' "$LOG" | head -n1 | grep -o '\[[^]]*\]' | head -n1)"
echo "earliest log line in window: ${first:-none}   total lines: $(printf '%s\n' "$LOG" | wc -l | tr -d ' ')"
echo

# Access log format: IP - - [time] "METHOD PATH HTTP/x" STATUS BYTES "REF" "UA" "-"
#   $7 = path, $9 = status.
printf '%s\n' "$LOG" | grep -iE "$AGENTS" | awk -v agents="$AGENTS" -v top="$TOP_PATHS" '
    BEGIN { n = split(agents, list, "|") }
    {
        lower = tolower($0); ua = "other"
        for (i = 1; i <= n; i++) if (index(lower, tolower(list[i]))) { ua = list[i]; break }
        hits[ua]++
        status[ua " " $9]++
        if (ua != "bingbot" && ua != "Googlebot") paths[ua "  " $7]++
        else if ($9 != 200 && $9 != 304) nonok[ua " " $9 " " $7]++
    }
    END {
        print "-- hits per user-agent"
        for (k in hits) printf "%8d  %s\n", hits[k], k | "sort -rn"
        close("sort -rn")
        print ""
        print "-- status per user-agent"
        for (k in status) printf "%8d  %s\n", status[k], k | "sort -k2,2 -k1,1rn"
        close("sort -k2,2 -k1,1rn")
        print ""
        print "-- paths fetched by AI agents (top " top ")"
        cmd = "sort -rn | head -n " top
        for (k in paths) printf "%8d  %s\n", paths[k], k | cmd
        close(cmd)
        print ""
        print "-- search bots: non-200 responses (legacy URLs, redirects, errors)"
        for (k in nonok) printf "%8d  %s\n", nonok[k], k | "sort -rn | head -n 40"
        close("sort -rn | head -n 40")
    }'
echo
exit 0
