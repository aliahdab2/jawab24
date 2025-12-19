#!/bin/bash
# Quick status check for Jawab24
# Run: ./scripts/check-status.sh

echo "🔍 Checking Jawab24 Status..."
echo ""

# Check website
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://jawab24.com/ 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Website: UP (HTTP $HTTP_CODE)"
else
  echo "❌ Website: DOWN (HTTP $HTTP_CODE)"
fi

# Check API
API_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://jawab24.com/api/health 2>/dev/null)
if [ "$API_CODE" = "200" ]; then
  echo "✅ API: UP (HTTP $API_CODE)"
else
  echo "❌ API: DOWN (HTTP $API_CODE)"
fi

# Check login page
LOGIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://jawab24.com/login 2>/dev/null)
if [ "$LOGIN_CODE" = "200" ]; then
  echo "✅ Login Page: UP (HTTP $LOGIN_CODE)"
else
  echo "❌ Login Page: DOWN (HTTP $LOGIN_CODE)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$HTTP_CODE" = "200" ] && [ "$API_CODE" = "200" ]; then
  echo "🎉 All systems operational!"
else
  echo "⚠️  Some services may be down"
  echo "Check: https://github.com/aliahdab2/jawab24/actions"
fi



