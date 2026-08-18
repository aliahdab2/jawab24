import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The revalidation target must follow the deploy colour.
 *
 * `FRONTEND_REVALIDATE_URL` points at the frontend over the internal compose
 * network, and blue/green run `frontend-blue` and `frontend-green` as separate
 * services. So the value is colour-scoped, exactly like `AI_SERVICE_URL` beside
 * it — and it must NOT live in `env/backend.env`, which both overlays share: a
 * colour written there is right on one deploy and wrong on the next.
 *
 * The wrong-colour failure is invisible, which is why it is worth a test. The
 * backend POSTs at whichever container the stale name resolves to. If the idle
 * one is still up, revalidation "succeeds" — it just refreshes the ISR cache of
 * a container serving nobody, so no error is logged, no Sentry warning fires,
 * and the pricing page keeps serving the old prices. That is the same silent
 * staleness the revalidation mechanism exists to prevent, reintroduced through
 * its own configuration.
 *
 * Sibling of frontend/test/deployBuildArgs.test.ts, which pins the same class
 * of blue/green compose divergence for NEXT_PUBLIC_* build args.
 */

const repoRoot = path.resolve(__dirname, '../..');

const OVERLAYS = [
    { colour: 'blue', file: 'docker-compose.blue.yml' },
    { colour: 'green', file: 'docker-compose.green.yml' },
] as const;

function readCompose(file: string): string {
    return readFileSync(path.join(repoRoot, file), 'utf8');
}

describe('FRONTEND_REVALIDATE_URL follows the deploy colour', () => {
    it.each(OVERLAYS)('$file targets frontend-$colour', ({ colour, file }) => {
        const source = readCompose(file);
        const match = source.match(/FRONTEND_REVALIDATE_URL=(\S+)/);

        expect(match, `${file} does not set FRONTEND_REVALIDATE_URL — revalidation is inert on this colour`).not.toBeNull();
        expect(match![1]).toBe(`http://frontend-${colour}:3001/api/revalidate`);
    });

    it.each(OVERLAYS)('$file never names the opposite colour', ({ colour, file }) => {
        const opposite = colour === 'blue' ? 'green' : 'blue';
        const match = readCompose(file).match(/FRONTEND_REVALIDATE_URL=(\S+)/);

        expect(
            match![1].includes(`frontend-${opposite}`),
            `${file} points revalidation at the ${opposite} frontend — every plan write would refresh the idle container and silently leave the live pricing page stale`,
        ).toBe(false);
    });

    /**
     * The shared env file is the trap this test exists for: a colour there is
     * overridden by the overlay today, so it would not break anything visibly —
     * it would just sit in the example waiting to be copied somewhere that has
     * no overlay to correct it.
     */
    it('is not hardcoded into the env file shared by both colours', () => {
        const example = readFileSync(path.join(repoRoot, 'env/backend.env.example'), 'utf8');
        const assignment = example.match(/^FRONTEND_REVALIDATE_URL=.*/m);

        expect(
            assignment,
            'env/backend.env.example assigns FRONTEND_REVALIDATE_URL — it is shared by blue and green, so it cannot carry a colour. Set it per overlay instead.',
        ).toBeNull();
    });

    /**
     * Guards this test's own premise. If the frontend stops listening on 3001
     * the URLs above are wrong while every assertion here still passes.
     */
    it('agrees with the port the frontend image actually listens on', () => {
        const dockerfile = readFileSync(path.join(repoRoot, 'frontend/Dockerfile'), 'utf8');
        const port = dockerfile.match(/^ENV\s+PORT=(\d+)/m);

        expect(port, 'frontend/Dockerfile no longer declares ENV PORT').not.toBeNull();
        expect(port![1]).toBe('3001');
    });
});
