#!/usr/bin/env bash
#
# Proves which upstream nginx routes each merchant-facing platform URL to.
#
# Runs the REAL nginx/nginx.conf inside an nginx container, with the blue-green
# upstreams replaced by stubs that echo "BACKEND" / "FRONTEND", then curls every
# platform URL and asserts the expected upstream. A pure `nginx -t` cannot catch
# the failure class this guards against: a syntactically perfect config in which
# a `location /zid/` prefix swallows a Next.js page (or is missing entirely, so
# an OAuth callback 404s) parses fine and fails only in production.
#
# Usage: ./scripts/check-nginx-routing.sh
# Exit:  0 = all routes land where expected, 1 = at least one is wrong.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGINX_CONF="$REPO_ROOT/nginx/nginx.conf"
CONTAINER="nginx-routing-check-$$"
IMAGE="nginx:alpine"

command -v docker >/dev/null 2>&1 || { echo "SKIP: docker not available"; exit 0; }
[ -f "$NGINX_CONF" ] || { echo "FAIL: $NGINX_CONF not found"; exit 1; }

WORKDIR="$(mktemp -d)"
cleanup() {
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$WORKDIR"
}
trap cleanup EXIT

# --- Stub upstreams: each echoes its identity and the URI it received ---------
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

# --- Boot nginx with the real config + a self-signed cert at the LE path ------
docker run -d --name "$CONTAINER" \
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
    ' >/dev/null || { echo "FAIL: could not start container"; exit 1; }

# Wait for nginx to answer rather than sleeping a fixed amount.
for _ in $(seq 1 50); do
    docker exec "$CONTAINER" curl -sk -o /dev/null \
        -H 'Host: jawab24.com' https://127.0.0.1/nginx-health 2>/dev/null && break
    sleep 0.2
done

if ! docker exec "$CONTAINER" nginx -t >/dev/null 2>&1; then
    echo "FAIL: nginx config did not pass 'nginx -t':"
    docker exec "$CONTAINER" nginx -t 2>&1 | sed 's/^/    /'
    exit 1
fi
echo "nginx -t: OK"
echo

# --- Expectations -------------------------------------------------------------
# Format: <requested path>|<expected upstream> <expected path AT the upstream>
#
# Asserting the upstream alone is not enough. The backend mounts Zid at
# `prefix: '/zid'` (integrations/zid.ts) and Salla at '/salla', while the
# `location /api/` block carries `rewrite ^/api/(.*)$ /$1 break`. So a block
# that reached the right upstream but rewrote (or failed to rewrite) the path
# would still 404 at Fastify. The stubs echo the request line they received,
# which is exactly what the real backend would see.
#
# Keep this table in step with the platform `location` blocks in nginx.conf.
ROUTES="
/salla/onboarding|FRONTEND_/salla/onboarding
/salla/connected|FRONTEND_/salla/connected
/shopify/onboarding|FRONTEND_/shopify/onboarding
/zid/onboarding|FRONTEND_/zid/onboarding
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

fails=0
printf '%-46s %-34s %s\n' "REQUESTED" "REACHES (upstream + path)" "RESULT"
printf '%-46s %-34s %s\n' "----------------------------------------------" \
    "----------------------------------" "------"

for entry in $ROUTES; do
    [ -z "$entry" ] && continue
    path="${entry%%|*}"
    expect="$(printf '%s' "${entry##*|}" | tr '_' ' ')"

    body="$(docker exec "$CONTAINER" curl -sk --max-time 5 \
        -H 'Host: jawab24.com' "https://127.0.0.1${path}" 2>/dev/null)"
    actual="$(printf '%s' "$body" | head -n1 | tr -d '\r')"
    [ -z "$actual" ] && actual="(no response)"

    if [ "$actual" = "$expect" ]; then
        printf '%-46s %-34s %s\n' "$path" "$actual" "ok"
    else
        printf '%-46s %-34s %s\n' "$path" "$actual" "WRONG"
        printf '%-46s %-34s\n' "" "expected: $expect"
        fails=$((fails + 1))
    fi
done

echo
if [ "$fails" -ne 0 ]; then
    echo "FAIL: $fails route(s) wrong."
    echo "  - wrong upstream: a Next.js page on BACKEND (or an OAuth callback on"
    echo "    FRONTEND) is a 404 for the merchant."
    echo "  - wrong path: right upstream, but Fastify has no route at that path,"
    echo "    so it 404s just the same."
    exit 1
fi
echo "PASS: all $(printf '%s' "$ROUTES" | grep -c '|') routes reach the expected upstream AND path."
