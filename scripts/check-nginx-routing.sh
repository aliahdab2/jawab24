#!/usr/bin/env bash
#
# Proves where nginx sends each merchant-facing platform URL — which upstream,
# AND at which path.
#
# Boots the REAL nginx/nginx.conf inside the SAME image production runs
# (nginx:alpine, see docker-compose.yml), with the blue-green upstreams replaced
# by stubs that echo the request line they received. Then curls every route and
# compares "<upstream> <path>" against an expected table.
#
# Why not just `nginx -t`: a config that routes a Next.js page to the backend, or
# an OAuth callback to the frontend, parses perfectly and fails only in
# production. On 2026-08-10 nginx.conf had no /zid/ block at all and the first
# real Zid install hit a 404; `nginx -t` said OK throughout.
#
# Why the path matters too: the backend mounts Zid at `prefix: '/zid'`
# (integrations/zid.ts) and `location /api/` carries a `rewrite ^/api/(.*)$ /$1`.
# A block reaching the right upstream at the wrong path still 404s at Fastify.
#
# FAILS only on a real routing mismatch or a genuine nginx config error.
# SKIPS (exit 0) when the environment cannot run the check — no docker, no
# network for the image pull, container won't start for non-config reasons.
# A CI/deploy gate must not turn an offline build host into a blocked deploy.
#
# Usage: ./scripts/check-nginx-routing.sh   (or: npm run check:nginx-routing)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGINX_CONF="$REPO_ROOT/nginx/nginx.conf"
CONTAINER="nginx-routing-check-$$"
# Must match docker-compose.yml's nginx service, or we are validating a
# different nginx than the one that will serve this config.
IMAGE="nginx:alpine"

skip() { echo "SKIP: $*"; exit 0; }

command -v docker >/dev/null 2>&1 || skip "docker not available"
docker info >/dev/null 2>&1 || skip "docker daemon not responding"
[ -f "$NGINX_CONF" ] || { echo "FAIL: $NGINX_CONF not found"; exit 1; }

WORKDIR="$(mktemp -d)"
cleanup() {
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$WORKDIR"
}
trap cleanup EXIT

# --- Stub upstreams: each echoes its identity + the request line it received ---
cat > "$WORKDIR/upstream.conf" <<'EOF'
upstream backend_active   { server 127.0.0.1:9001; }
upstream frontend_active  { server 127.0.0.1:9002; }
upstream ai_worker_active { server 127.0.0.1:9003; }

server {
    listen 127.0.0.1:9001;
    location / { default_type text/plain; return 200 "BACKEND $request_uri\n"; }
}
server {
    listen 127.0.0.1:9002;
    location / { default_type text/plain; return 200 "FRONTEND $request_uri\n"; }
}
server {
    listen 127.0.0.1:9003;
    location / { default_type text/plain; return 200 "AIWORKER $request_uri\n"; }
}
EOF

# --- Boot nginx with the real config + a throwaway cert at the Let's Encrypt path
if ! docker run -d --name "$CONTAINER" \
    -v "$NGINX_CONF:/etc/nginx/nginx.conf:ro" \
    -v "$WORKDIR/upstream.conf:/etc/nginx/upstream.conf:ro" \
    --entrypoint sh "$IMAGE" -c '
        mkdir -p /etc/letsencrypt/live/jawab24.com &&
        apk add --no-cache openssl >/dev/null 2>&1 &&
        openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
            -subj "/CN=jawab24.com" \
            -keyout /etc/letsencrypt/live/jawab24.com/privkey.pem \
            -out   /etc/letsencrypt/live/jawab24.com/fullchain.pem >/dev/null 2>&1 &&
        nginx -g "daemon off;"
    ' >/dev/null 2>&1
then
    skip "could not create the $IMAGE container (offline image pull?)"
fi

# Wait for nginx to answer rather than sleeping a fixed amount.
ready=0
for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" curl -sk -o /dev/null --max-time 2 \
        -H 'Host: jawab24.com' https://127.0.0.1/nginx-health 2>/dev/null; then
        ready=1
        break
    fi
    sleep 0.25
done

if [ "$ready" -ne 1 ]; then
    # nginx refusing to start is EITHER a real config error (must fail) OR an
    # environment problem such as a failed apk/openssl step (must skip).
    # nginx writes "[emerg]" to the log for config errors — that is the tell.
    if docker logs "$CONTAINER" 2>&1 | grep -q '\[emerg\]'; then
        echo "FAIL: nginx refused to start with this config:"
        docker logs "$CONTAINER" 2>&1 | grep '\[emerg\]' | sed 's/^/    /'
        echo "    A config nginx cannot start is a full outage — the deploy script's"
        echo "    post-restart loop only checks 'nginx -v' and would not catch it."
        exit 1
    fi
    skip "nginx did not come up and reported no config error (environment issue)"
fi

if ! docker exec "$CONTAINER" nginx -t >/dev/null 2>&1; then
    echo "FAIL: nginx config did not pass 'nginx -t':"
    docker exec "$CONTAINER" nginx -t 2>&1 | sed 's/^/    /'
    exit 1
fi
echo "nginx -t: OK  (image: $IMAGE, same as docker-compose.yml)"
echo

# --- Expectations -------------------------------------------------------------
# Format: <requested path>|<expected upstream>_<expected path AT the upstream>
# ('_' stands in for the space, so each row stays one whitespace-free token.)
#
# Keep this table in step with the platform `location` blocks in nginx.conf.
ROUTES="
/salla/onboarding|FRONTEND_/salla/onboarding
/salla/connected|FRONTEND_/salla/connected
/shopify/onboarding|FRONTEND_/shopify/onboarding
/zid/onboarding|FRONTEND_/zid/onboarding
/zid/embedded|FRONTEND_/zid/embedded
/zid/embedded/session|BACKEND_/zid/embedded/session
/salla/auth|BACKEND_/salla/auth
/salla/auth/callback|BACKEND_/salla/auth/callback
/salla/webhooks|BACKEND_/salla/webhooks
/shopify/auth|BACKEND_/shopify/auth
/shopify/webhooks|BACKEND_/shopify/webhooks
/zid/auth|BACKEND_/zid/auth
/zid/auth/callback|BACKEND_/zid/auth/callback
/zid/webhooks?e=app.market.application.uninstall&sid=42|BACKEND_/zid/webhooks?e=app.market.application.uninstall&sid=42
/zid/store|BACKEND_/zid/store
/api/zid/auth|BACKEND_/zid/auth
"
# --- Non-regression: routes this change must NOT move -------------------------
# The platform blocks sit in the middle of a shared request pipeline. These pin
# the paths that carry real traffic today, so a future edit to a `location`
# cannot quietly re-route them. Locale-prefixed pages matter specifically
# because /en/... and /ar/... do NOT match the `location /zid/` prefix — they
# reach the frontend via the catch-all, and auth/callback.tsx redirects to the
# locale-prefixed form for English merchants.
ROUTES="$ROUTES
/|FRONTEND_/
/pricing|FRONTEND_/pricing
/en/zid/onboarding|FRONTEND_/en/zid/onboarding
/ar/zid/onboarding|FRONTEND_/ar/zid/onboarding
/en/salla/connected|FRONTEND_/en/salla/connected
/ar/salla/connected|FRONTEND_/ar/salla/connected
/webhook|BACKEND_/webhook
/api/pages|BACKEND_/pages
/api/auth/login|BACKEND_/auth/login
/ai/generate|AIWORKER_/generate
"
# --- Known, accepted behaviour: trailing slash ---------------------------------
# `location = /x/page` matches the exact URI only, so the TRAILING-SLASH form
# falls through to the platform prefix block and reaches the backend, which has
# no such route (404) instead of the frontend's redirect-to-canonical. Salla has
# behaved exactly this way since its prefix block shipped, nothing links to the
# slashed form, and the alternative (a regex location) would take precedence over
# every prefix block here and is not worth the subtlety. Pinned so the behaviour
# is a decision on record rather than a surprise.
ROUTES="$ROUTES
/salla/onboarding/|BACKEND_/salla/onboarding/
/zid/onboarding/|BACKEND_/zid/onboarding/
"

fails=0
printf '%-56s %-40s %s\n' "REQUESTED" "REACHES (upstream + path)" "RESULT"
printf '%-56s %-40s %s\n' \
    "--------------------------------------------------------" \
    "----------------------------------------" "------"

for entry in $ROUTES; do
    [ -z "$entry" ] && continue
    path="${entry%%|*}"
    expect="$(printf '%s' "${entry##*|}" | tr '_' ' ')"

    body="$(docker exec "$CONTAINER" curl -sk --max-time 5 \
        -H 'Host: jawab24.com' "https://127.0.0.1${path}" 2>/dev/null)"
    actual="$(printf '%s' "$body" | head -n1 | tr -d '\r')"
    [ -z "$actual" ] && actual="(no response)"

    if [ "$actual" = "$expect" ]; then
        printf '%-56s %-40s %s\n' "$path" "$actual" "ok"
    else
        printf '%-56s %-40s %s\n' "$path" "$actual" "WRONG"
        printf '%-56s %-40s\n' "" "expected: $expect"
        fails=$((fails + 1))
    fi
done

# --- Legacy WordPress URLs must answer 410 (SEO) --------------------------------
# The old French site's post slugs are removed from Bing/Google fastest with 410.
# Rule 3c in nginx.conf matches any hyphenated single segment with a trailing
# slash; the hyphenated CURRENT pages are excluded by name and must keep reaching
# the frontend (which redirects the slashed form to the canonical URL).
echo
LEGACY_410="
/villes-fantomes-celebres-au-canada/
/quest-ce-quun-flux-perdant/
/2022/04/21/la-catastrophe-de-tchernobyl/
/les-pays-les-plus-riches-deurope-2/
/sitemap_index.xml
"
for path in $LEGACY_410; do
    [ -z "$path" ] && continue
    code="$(docker exec "$CONTAINER" curl -sk --max-time 5 -o /dev/null -w '%{http_code}' \
        -H 'Host: jawab24.com' "https://127.0.0.1${path}" 2>/dev/null)"
    if [ "$code" = "410" ]; then
        printf '%-56s %-40s %s\n' "$path" "410 Gone" "ok"
    else
        printf '%-56s %-40s %s\n' "$path" "HTTP ${code:-?}" "WRONG (expected 410)"
        fails=$((fails + 1))
    fi
done
for path in /what-is-jawab24/ /data-deletion/ /complete-profile/; do
    body="$(docker exec "$CONTAINER" curl -sk --max-time 5 -H 'Host: jawab24.com' "https://127.0.0.1${path}" 2>/dev/null | head -n1 | tr -d '\r')"
    if [ "$body" = "FRONTEND ${path}" ]; then
        printf '%-56s %-40s %s\n' "$path" "$body" "ok (excluded from 410)"
    else
        printf '%-56s %-40s %s\n' "$path" "${body:-(no response)}" "WRONG (a current page is answering 410)"
        fails=$((fails + 1))
    fi
done

# --- Framing headers (Zid Embedded Apps) --------------------------------------
# Asserted against the LIVE response, not the file: the Zid dashboard iframe is
# blocked outright by X-Frame-Options (which has no allowlist form), so a
# well-meaning "restore the security header" edit would silently kill the
# integration. frame-ancestors is what replaced it — see nginx.conf.
echo
headers="$(docker exec "$CONTAINER" curl -sk --max-time 5 -D - -o /dev/null \
    -H 'Host: jawab24.com' "https://127.0.0.1/zid/embedded" 2>/dev/null | tr -d '\r')"

if printf '%s' "$headers" | grep -qi '^x-frame-options:'; then
    echo "WRONG  X-Frame-Options is set — it has no allowlist and blocks the Zid iframe."
    echo "       Use the CSP frame-ancestors directive instead."
    fails=$((fails + 1))
else
    echo "ok     X-Frame-Options absent (superseded by frame-ancestors)"
fi

for host in "https://dashboard.zid.sa" "https://web.zid.sa"; do
    if printf '%s' "$headers" | grep -i '^content-security-policy:' | grep -q "frame-ancestors[^;]*$host"; then
        echo "ok     frame-ancestors allows $host"
    else
        echo "WRONG  frame-ancestors does not allow $host — the embedded app will not load."
        fails=$((fails + 1))
    fi
done

# The production CSP must NOT allow Zid's *.zid.dev sandbox — a wildcard over a
# dev domain would let any *.zid.dev subdomain frame the live dashboard.
if printf '%s' "$headers" | grep -i '^content-security-policy:' | grep -q 'frame-ancestors[^;]*zid\.dev'; then
    echo "WRONG  frame-ancestors allows a *.zid.dev sandbox host in production — drop it."
    fails=$((fails + 1))
else
    echo "ok     frame-ancestors excludes the *.zid.dev sandbox"
fi

echo
if [ "$fails" -ne 0 ]; then
    echo "FAIL: $fails route(s)/header(s) wrong."
    echo "  - wrong upstream: a Next.js page on BACKEND (or an OAuth callback on"
    echo "    FRONTEND) is a 404 for the merchant."
    echo "  - wrong path: right upstream, but Fastify has no route there, so it"
    echo "    404s just the same."
    echo "  - exact-match blocks (location = /x/page) must sit ABOVE the prefix"
    echo "    block (location /x/), or the prefix swallows the page."
    exit 1
fi
echo "PASS: all $(printf '%s' "$ROUTES" | grep -c '|') routes reach the expected upstream AND path, and the framing headers allow the Zid dashboard."
