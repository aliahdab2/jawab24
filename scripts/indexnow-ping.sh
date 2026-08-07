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
# Usage:  ./scripts/indexnow-ping.sh [--all] [sitemap-url]
#           --all  submit every URL in the sitemap, not just recently-changed
#                  ones. Use for the first submission, when Bing has no record
#                  of the site at all.
set -uo pipefail

HOST="jawab24.com"
KEY="7af41c595343ef134170a2de37da0079"
KEY_LOCATION="https://${HOST}/${KEY}.txt"
ENDPOINT="https://api.indexnow.org/indexnow"

# IndexNow is specified for URLs that CHANGED. Resubmitting the whole sitemap on
# every deploy — including deploys that touched no public content — is not the
# documented usage and is what the 429 response exists to punish. Default to
# URLs whose <lastmod> falls inside this window.
CHANGED_WITHIN_DAYS="${INDEXNOW_WINDOW_DAYS:-30}"

SUBMIT_ALL=0
if [ "${1:-}" = "--all" ]; then
    SUBMIT_ALL=1
    shift
fi
SITEMAP="${1:-https://${HOST}/sitemap.xml}"

echo "🔔 IndexNow: collecting URLs from ${SITEMAP}"

# Pull <loc> values from the live sitemap. Static, well-formed XML → grep/sed is
# enough (same reasoning as validate-sitemap.js parsing it with a regex).
# NOTE: two explicit -e expressions, not `s|</\?loc>||g` — `\?` is a GNU-sed
# extension that BSD/macOS sed does not support, and there it silently leaves the
# tags in place, producing "<loc>https://…</loc>" entries that IndexNow rejects
# with 422. This form is portable to both.
SITEMAP_XML=$(curl -sL --max-time 20 "$SITEMAP" 2>/dev/null)

if [ "$SUBMIT_ALL" -eq 1 ]; then
    RAW_URLS=$(printf '%s' "$SITEMAP_XML" \
        | grep -o '<loc>[^<]*</loc>' \
        | sed -e 's|<loc>||g' -e 's|</loc>||g')
    SCOPE="all"
else
    # Keep <loc> only when its sibling <lastmod> is inside the window. Each
    # <url> block is flattened to one line first so the pair stays together.
    CUTOFF=$(date -u -v-"${CHANGED_WITHIN_DAYS}"d '+%Y-%m-%d' 2>/dev/null \
        || date -u -d "${CHANGED_WITHIN_DAYS} days ago" '+%Y-%m-%d' 2>/dev/null)
    RAW_URLS=$(printf '%s' "$SITEMAP_XML" \
        | tr -d '\n' \
        | sed -e 's|</url>|\'$'\n''|g' \
        | awk -v cutoff="$CUTOFF" '
            match($0, /<loc>[^<]*<\/loc>/) {
                loc = substr($0, RSTART + 5, RLENGTH - 11)
                lastmod = ""
                if (match($0, /<lastmod>[^<]*<\/lastmod>/))
                    lastmod = substr($0, RSTART + 9, RLENGTH - 19)
                # No <lastmod> means we cannot prove it is unchanged — submit it.
                if (lastmod == "" || lastmod >= cutoff) print loc
            }')
    SCOPE="changed in the last ${CHANGED_WITHIN_DAYS}d"
fi

# Keep only URLs on our own host. IndexNow rejects the whole batch (422) if any
# URL belongs elsewhere, and this also bounds what reaches the JSON payload —
# the sitemap arrives over the network and the URL is overridable via argv, so
# it is not trusted input even though it is normally ours.
URLS=$(printf '%s\n' "$RAW_URLS" | grep -E "^https://${HOST}/" || true)

if [ -z "$URLS" ]; then
    if [ "$SUBMIT_ALL" -eq 0 ]; then
        echo "   ℹ️  No URLs ${SCOPE} — nothing to submit (use --all to force a full submission)"
    else
        echo "   ⚠️  Could not read any on-host URLs from the sitemap — skipping IndexNow ping"
    fi
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
        echo "   ✅ IndexNow accepted ${URL_COUNT} URLs — ${SCOPE} (HTTP ${HTTP_CODE})"
        ;;
    400) echo "   ⚠️  IndexNow rejected the request as malformed (HTTP 400) — payload bug, not a deploy problem" ;;
    403) echo "   ⚠️  IndexNow rejected the key (HTTP 403) — ${KEY_LOCATION} must return exactly ${KEY}" ;;
    422) echo "   ⚠️  IndexNow rejected the URLs (HTTP 422) — they must all be on ${HOST}" ;;
    429) echo "   ⚠️  IndexNow rate-limited this host (HTTP 429) — will succeed on a later deploy" ;;
    *)   echo "   ⚠️  IndexNow ping failed (HTTP ${HTTP_CODE}) — continuing, Bing will recrawl organically" ;;
esac

exit 0
