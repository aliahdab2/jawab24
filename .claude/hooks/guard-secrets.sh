#!/bin/bash
# Guard against secret exposure in Bash commands
# Receives tool input as JSON on stdin

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('command',''))" 2>/dev/null)

# Block commands that read .env files directly
if echo "$COMMAND" | grep -qE '(cat|head|tail|less|more|bat)\s+.*\.env'; then
  echo "BLOCKED: Reading .env files directly. Use environment variables instead." >&2
  exit 2
fi

# Block commands with inline tokens/secrets (long hex/base64 strings assigned to token-like vars)
if echo "$COMMAND" | grep -qE '(TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)="[A-Za-z0-9+/=_.-]{40,}"'; then
  echo "BLOCKED: Inline secrets detected. Use environment variables or source from .env files." >&2
  exit 2
fi

# Block reading private key files
if echo "$COMMAND" | grep -qE '(cat|head|tail|less)\s+.*\.(pem|key|keystore|p12)'; then
  echo "BLOCKED: Reading private key files." >&2
  exit 2
fi

exit 0
