Run the Jawab24 test suite.

Arguments: $ARGUMENTS
- If arguments include "frontend", run frontend tests only
- If arguments include a file path or component name, run tests matching that pattern
- Default: run all tests

Commands:
```bash
# All tests
npm run test

# Frontend only
cd frontend && npm run test

# Specific file or pattern
cd frontend && npm run test -- <pattern>
```

After running, report:
- How many tests passed / failed
- Which tests failed and why
- Suggest fixes for any failures
