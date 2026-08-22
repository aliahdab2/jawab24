#!/bin/bash
# PostToolUse hook — fires after Write/Edit on code files.
# Injects a one-time-per-session reminder about Rule 15 docs
# (SYSTEM_ANALYSIS.md, INTEGRATIONS.md, ARCHITECTURE.md).

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')

case "$file_path" in
    */backend/src/*|*/frontend/src/*|*/ai-worker/src/*|*/packages/shared/src/*)
        ;;
    *)
        exit 0
        ;;
esac

sentinel="/tmp/claude-docs-reminder-${session_id}"
if [ -f "$sentinel" ]; then
    exit 0
fi
touch "$sentinel"

cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Rule 15 reminder: a code file under backend/frontend/ai-worker/packages was just edited. Before finishing, check whether these docs need a same-commit update: SYSTEM_ANALYSIS.md (platform table, resolved gaps, status), .planning/codebase/INTEGRATIONS.md (integration details), .planning/codebase/ARCHITECTURE.md (structural changes). If none apply to this change, proceed as normal. This reminder fires once per session."
  }
}
EOF
exit 0
