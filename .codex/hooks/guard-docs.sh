#!/bin/bash
# PreToolUse hook — fires before git commit commands.
# Warns if source files are staged but no documentation files are.
# Non-blocking: exits 0 so the commit is never prevented automatically.

STAGED_SOURCE=$(git diff --cached --name-only 2>/dev/null | grep -cE "^(backend|frontend|ai-worker)/src/")
STAGED_DOCS=$(git diff --cached --name-only 2>/dev/null | grep -cE "\.(md)$")

if [ "$STAGED_SOURCE" -gt "0" ] && [ "$STAGED_DOCS" -eq "0" ]; then
    echo "⚠️  Source files are staged but no documentation files are."
    echo ""
    echo "   Consider whether these need updating before committing:"
    echo "   • SYSTEM_ANALYSIS.md         — platform table, resolved gaps"
    echo "   • .planning/codebase/INTEGRATIONS.md  — integration status"
    echo "   • .planning/codebase/ARCHITECTURE.md  — structural changes"
    echo ""
    echo "   If no docs need updating for this change, proceed normally."
fi

exit 0
