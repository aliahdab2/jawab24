Deploy Jawab24 to the production server.

Arguments: $ARGUMENTS

Steps:
1. Check if arguments include "skip-tests" or "skip tests" — if so, add `--skip-tests` flag
2. Run from the project root:
   - Normal: `./scripts/deploy-production.sh -y`
   - Skip tests: `./scripts/deploy-production.sh -y --skip-tests`
3. Watch the output and summarize what happened:
   - Which checks passed or failed
   - How long it took
   - Confirm success or explain what went wrong with next steps

After success, verify: https://jawab24.com/api/health
