import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Frontend-bundle guard: the language module (and its Phase-1b tinyld
 * dependency) must NEVER be reachable from the package barrel, because the
 * frontend imports `@jawab24/shared` (→ dist/index.js) and Next.js/webpack
 * would pull anything the barrel references into the client bundle.
 *
 * Consumers must use the deep imports instead:
 *   '@jawab24/shared/dist/language/detector'      (backend)
 *   '@jawab24/shared/dist/language/resolveChain'  (ai-worker)
 *
 * We assert on the barrel SOURCE (stable, no build required) — any
 * import/export of ./language in src/index.ts would compile into a require()
 * in dist/index.js.
 */
describe('shared barrel does not expose the language module', () => {
    it('src/index.ts has no import/export from ./language', () => {
        // Resolve relative to THIS test file, not process.cwd() — the guard must
        // assert correctly regardless of where vitest is invoked from (repo root,
        // workspace dir, or a single-file run). Using cwd would throw ENOENT off
        // the workspace path, or silently read the wrong index.ts, eroding the
        // protection unnoticed. __dirname is available: this package compiles to CJS.
        const barrel = readFileSync(join(__dirname, '../../index.ts'), 'utf8');
        expect(barrel).not.toMatch(/['"]\.\/language/);
    });
});
