#!/bin/bash
# Start THIS WORKTREE's ai-worker for the local battery.
#
# The worktree's own code must run — promptBuilder and replyValidator are the things
# under test. Only the environment comes from the main checkout's ai-worker/.env, which
# is where OPENAI_API_KEY lives (the /eval skill's documented approach: load it, never
# print it, never ask for it).
set -e
cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
source /Users/aliahdab/Documents/AutoReply/ai-worker/.env
set +a
export PORT=3005
exec npx tsx ai-worker/src/index.ts
