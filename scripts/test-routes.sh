#!/bin/bash

# Test Routes Script
# Run this after deployment to verify all routes are working

set -e

BASE_URL="${1:-https://jawab24.com}"
PASSED=0
FAILED=0

echo "🧪 Testing Routes on $BASE_URL"
echo "================================"

# Function to test a route
test_route() {
    local method=$1
    local path=$2
    local expected_not=$3
    local description=$4
    local data=$5

    if [ "$method" == "POST" ] && [ -n "$data" ]; then
        status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path" -H "Content-Type: application/json" -d "$data")
    else
        status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path")
    fi

    if [ "$status" != "$expected_not" ]; then
        echo "✅ $description - Status: $status"
        ((PASSED++))
    else
        echo "❌ $description - Got $status (should not be $expected_not)"
        ((FAILED++))
    fi
}

echo ""
echo "📡 API Routes (/api/*)"
echo "----------------------"
test_route "POST" "/api/auth/facebook" "404" "POST /api/auth/facebook" '{"code":"test"}'
test_route "GET" "/api/auth/me" "404" "GET /api/auth/me"
test_route "GET" "/api/pages" "404" "GET /api/pages"
test_route "POST" "/api/pages/sync" "404" "POST /api/pages/sync" '{"accessToken":"test"}'

echo ""
echo "🔗 Webhook Routes"
echo "-----------------"
test_route "GET" "/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=test" "404" "GET /webhook (verification)"
test_route "POST" "/webhook" "404" "POST /webhook (events)" '{"object":"page","entry":[]}'

echo ""
echo "🖥️ Frontend Routes"
echo "------------------"
test_route "GET" "/" "404" "GET / (homepage)"
test_route "GET" "/login" "404" "GET /login"
test_route "GET" "/dashboard" "404" "GET /dashboard"
test_route "GET" "/auth/callback" "404" "GET /auth/callback"

echo ""
echo "❤️ Health Check"
echo "---------------"
test_route "GET" "/health" "404" "GET /health"

echo ""
echo "================================"
echo "Results: $PASSED passed, $FAILED failed"

if [ $FAILED -gt 0 ]; then
    echo "⚠️ Some routes are not working!"
    exit 1
else
    echo "✅ All routes are working!"
    exit 0
fi









