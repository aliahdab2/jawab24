#!/bin/bash
# Run the real Stripe round-trip (test mode) — subscribe → pay → activate.
#
# Prompts for the key instead of taking it as an argument. Two separate
# placeholder pastes have already broken this ("sk_test_..." and
# "sk_test_51SlAFl…YOUR_REAL_KEY", the latter carrying a Unicode ellipsis that
# corrupted the HTTP auth header and surfaced as a confusing connection error).
# A prompt cannot be copy-pasted wrong, and the key never lands in the command
# line, the shell history, or any file.
#
#   ./scripts/stripe-roundtrip.sh
#
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ""
echo "Real Stripe round-trip — TEST MODE"
echo "──────────────────────────────────"
echo "Get the key: https://dashboard.stripe.com/test/apikeys"
echo "  → make sure the 'Test mode' toggle is ON"
echo "  → Secret key → Reveal test key → copy"
echo ""
echo -e "${YELLOW}Paste it below (input is hidden), then press Enter:${NC}"
printf "  sk_test_"
read -rs KEY_TAIL
echo ""
echo ""

KEY="sk_test_${KEY_TAIL#sk_test_}"   # tolerate pasting the full key or just the tail

# Whitelist the real shape rather than blocklisting placeholders: sk_test_ plus
# ~99 base62 chars. Rejects non-ASCII, underscores from words like
# YOUR_REAL_KEY, and anything too short.
if ! [[ "$KEY" =~ ^sk_test_[A-Za-z0-9]{24,}$ ]]; then
    echo -e "${RED}❌ That doesn't look like a Stripe test key.${NC}"
    echo "   Got ${#KEY} characters; a real one is about 107."
    echo "   Expected: sk_test_ followed by letters and digits only."
    echo ""
    echo "   If you pasted placeholder text from a command, copy the actual key"
    echo "   from the dashboard link above instead."
    exit 1
fi

echo -e "${GREEN}✅ Key format looks right (${#KEY} chars, test mode)${NC}"
echo ""
echo "Running: subscribe → assert metadata → pay with test card → activate locally"
echo ""

cd "$ROOT/backend"
STRIPE_ROUNDTRIP=1 STRIPE_SECRET_KEY="$KEY" \
    npm run test:integration:local -- stripe.roundtrip
