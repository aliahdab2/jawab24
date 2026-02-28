Run linting on the Jawab24 codebase.

Arguments: $ARGUMENTS
- If arguments include "fix", run auto-fix
- Default: check only (no changes)

Commands:
```bash
# Check only
npm run lint

# Auto-fix
npm run lint:fix
```

The codebase must have zero errors AND zero warnings.

After running, report:
- How many errors and warnings found
- Which files have issues (if any)
- Whether auto-fix resolved everything or if manual fixes are needed
