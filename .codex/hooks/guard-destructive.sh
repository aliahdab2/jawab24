#!/bin/bash
# Guard against destructive operations
# Receives tool input as JSON on stdin

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('command',''))" 2>/dev/null)

# Block rm -rf on critical directories
if echo "$COMMAND" | grep -qE 'rm\s+-r[f]?\s+(/|~|/Users|/home|\$HOME)\s'; then
  echo "BLOCKED: Recursive deletion of critical directories." >&2
  exit 2
fi

# Block git push --force to main/master (allow --force-with-lease)
if echo "$COMMAND" | grep -qE 'git\s+push\s+--force\b' && echo "$COMMAND" | grep -qE '\b(main|master)\b' && ! echo "$COMMAND" | grep -q 'force-with-lease'; then
  echo "BLOCKED: Force push to main/master. Use --force-with-lease if needed." >&2
  exit 2
fi

# Block DROP DATABASE on production databases
if echo "$COMMAND" | grep -qiE 'DROP\s+DATABASE.*(caryo|autoreply)\b' && ! echo "$COMMAND" | grep -qiE '_test'; then
  echo "BLOCKED: Dropping production database." >&2
  exit 2
fi

exit 0
