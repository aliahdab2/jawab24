import { describe, it, expect } from 'vitest';
import axios from 'axios';

/**
 * Pins the network guard installed in test/setup.ts.
 *
 * Mutation check: with the guard removed, this request hits 127.0.0.1:1 and
 * rejects with ECONNREFUSED — a rejection too, but not this message — so the
 * assertion on the message is what makes the test fail without the guard.
 */
describe('unit-test network guard', () => {
    it('rejects any real HTTP dispatch with the guard message', async () => {
        await expect(axios.get('http://127.0.0.1:1/unreachable')).rejects.toThrow(
            /Unit tests must not make real HTTP requests/,
        );
    });

    it('applies to instances created via axios.create (the fbAxios shape)', async () => {
        const instance = axios.create({ timeout: 5000 });
        await expect(instance.get('http://127.0.0.1:1/unreachable')).rejects.toThrow(
            /Unit tests must not make real HTTP requests/,
        );
    });
});
