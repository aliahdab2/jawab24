#!/bin/bash
#
# IndexNow ping — tell Bing (and Yandex, Seznam, Naver) that jawab24.com changed.
#
# Why this matters beyond Bing itself: Bing is the retrieval index behind ChatGPT
# search and Copilot. A page Bing has not crawled is structurally invisible to
# those assistants no matter how good its markup is. IndexNow is the standard,
# no-account way to push URLs at that index the moment a deploy lands, instead of
# waiting for an organic recrawl.
#
# Ownership is proved by serving the key back at a public URL — that is the whole
# protocol. The key is PUBLIC by design (frontend/public/<key>.txt); it is not a
# secret and must be committed so it ships with the frontend image.
#
# Non-fatal by design: a failed ping must never fail a deploy. Worst case Bing
# discovers the change on its own schedule, exactly as it did before.
#
# Usage:  ./scripts/indexnow-ping.sh [sitemap-url]
set -uo pipefail

HOST="jawab24.com"
KEY="7af41c595343ef134170a2de37da0079"
KEY_LOCATION="https://${HOST}/${KEY}.txt"
SITEMAP="${1:-https://${HOST}/sitemap.xml}"
ENDPOINT="https://api.indexnow.org/indexnow"

echo "🔔 IndexNow: collecting URLs from ${SITEMAP}"

# Pull <loc> values from the live sitemap. Static, well-formed XML → grep/sed is
# enough (same reasoning as validate-sitemap.js parsing it with a regex).
# NOTE: two explicit -e expressions, not `s|</\?loc>||g` — `\?` is a GNU-sed
# extension that BSD/macOS sed does not support, and there it silently leaves the
# tags in place, producing "<loc>https://…</loc>" entries that IndexNow rejects
# with 422. This form is portable to both.
URLS=$(curl -sL --max-time 20 "$SITEMAP" 2>/dev/null \
    | grep -o '<loc>[^<]*</loc>' \
    | sed -e 's|<loc>||g' -e 's|</loc>||g')

if [ -z "$URLS" ]; then
    echo "   ⚠️  Could not read any URLs from the sitemap — skipping IndexNow ping"
    exit 0
fi

URL_COUNT=$(printf '%s\n' "$URLS" | wc -l | tr -d ' ')

# Verify the key file actually resolves before submitting. If it 404s, IndexNow
# rejects the whole batch — better to say so plainly than to submit into a void.
KEY_CHECK=$(curl -sL --max-time 10 -o /dev/null -w '%{http_code}' "$KEY_LOCATION" 2>/dev/null || echo "000")
if [ "$KEY_CHECK" != "200" ]; then
    echo "   ⚠️  Key file ${KEY_LOCATION} returned HTTP ${KEY_CHECK} (expected 200) — skipping ping"
    echo "      The key file ships in frontend/public/; confirm it survived the build."
    exit 0
fi

# Build the JSON payload (urlList as a JSON array of strings).
URL_JSON=$(printf '%s\n' "$URLS" | sed 's/.*/"&"/' | paste -sd, -)
PAYLOAD=$(cat <<EOF
{"host":"${HOST}","key":"${KEY}","keyLocation":"${KEY_LOCATION}","urlList":[${URL_JSON}]}
EOF
)

HTTP_CODE=$(curl -s --max-time 25 -o /dev/null -w '%{http_code}' \
    -X POST "$ENDPOINT" \
    -H 'Content-Type: application/json; charset=utf-8' \
    -d "$PAYLOAD" 2>/dev/null || echo "000")

# 200 = accepted, 202 = accepted pending key validation. Both are success.
case "$HTTP_CODE" in
    200|202)
        echo "   ✅ IndexNow accepted ${URL_COUNT} URLs (HTTP ${HTTP_CODE})"
        ;;
    400) echo "   ⚠️  IndexNow rejected the request as malformed (HTTP 400) — payload bug, not a deploy problem" ;;
    403) echo "   ⚠️  IndexNow rejected the key (HTTP 403) — ${KEY_LOCATION} must return exactly ${KEY}" ;;
    422) echo "   ⚠️  IndexNow rejected the URLs (HTTP 422) — they must all be on ${HOST}" ;;
    429) echo "   ⚠️  IndexNow rate-limited this host (HTTP 429) — will succeed on a later deploy" ;;
    *)   echo "   ⚠️  IndexNow ping failed (HTTP ${HTTP_CODE}) — continuing, Bing will recrawl organically" ;;
esac

exit 0
