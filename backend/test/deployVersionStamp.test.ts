import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * `GET /api/version` must report the commit the image was BUILT from.
 *
 * It is the only way we confirm what actually shipped — every deploy in this
 * repo is verified by comparing that SHA against the merge commit — so an
 * endpoint that answers "unknown" does not merely lose a nicety, it removes
 * the check.
 *
 * The trap is a compose `environment:` entry. `backend/Dockerfile` already
 * bakes the value (`ARG GIT_COMMIT` + `ENV GIT_COMMIT=${GIT_COMMIT}`) from the
 * build arg, and a compose `environment:` entry OVERRIDES the image's ENV. So
 * listing GIT_COMMIT there means any `docker compose up` run in a shell that
 * does not export it replaces the real commit with the literal `unknown`.
 *
 * That is not hypothetical: `--force-recreate --no-deps` is the documented way
 * to reload env on this host, it does not go through the deploy script that
 * exports GIT_COMMIT, and production was observed on 2026-08-19 serving
 * `{"version":"unknown"}` from an image whose dist contained the expected code.
 *
 * The build arg (under `build.args`) is the correct home and must stay.
 */

const repoRoot = path.resolve(__dirname, '../..');

const COMPOSE_OVERLAYS = ['docker-compose.blue.yml', 'docker-compose.green.yml'] as const;

/**
 * Lines under a service's `environment:` block, i.e. runtime values. Compose
 * indents `build.args` entries deeper (8 spaces) than `environment:` entries
 * (6), which is what separates the two here.
 */
function runtimeEnvLines(source: string): string[] {
    return source.split('\n').filter((line) => /^ {6}- \S/.test(line));
}

function buildArgLines(source: string): string[] {
    return source.split('\n').filter((line) => /^ {8}- \S/.test(line));
}

describe('the deployed version stamp survives a container recreate', () => {
    it.each(COMPOSE_OVERLAYS)('%s does not override GIT_COMMIT at runtime', (file) => {
        const source = readFileSync(path.join(repoRoot, file), 'utf8');
        const offending = runtimeEnvLines(source).filter((l) => l.includes('GIT_COMMIT'));

        expect(
            offending,
            `${file} sets GIT_COMMIT under environment:, which overrides the value the Dockerfile baked. `
            + 'A recreate without GIT_COMMIT exported would make /api/version report "unknown".',
        ).toEqual([]);
    });

    /**
     * The other half: removing the runtime entry is only safe because the build
     * arg still delivers the value. Without this, deleting both would pass the
     * assertion above while leaving every image stamped "unknown".
     */
    it.each(COMPOSE_OVERLAYS)('%s still passes GIT_COMMIT as a build arg', (file) => {
        const source = readFileSync(path.join(repoRoot, file), 'utf8');
        const args = buildArgLines(source).filter((l) => l.includes('GIT_COMMIT'));

        expect(args.length, `${file} must pass GIT_COMMIT under build.args so the image is stamped`).toBeGreaterThan(0);
    });

    /** And the Dockerfile has to actually turn that arg into an env var. */
    it('the backend Dockerfile bakes the build arg into the image', () => {
        const dockerfile = readFileSync(path.join(repoRoot, 'backend/Dockerfile'), 'utf8');

        expect(dockerfile).toMatch(/^ARG\s+GIT_COMMIT/m);
        expect(dockerfile).toMatch(/^ENV\s+GIT_COMMIT=\$\{GIT_COMMIT\}/m);
    });
});
