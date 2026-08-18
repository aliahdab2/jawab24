/**
 * Tests: reading the GA4 client id out of the `_ga` cookie (utils/analytics).
 *
 * This parse is the whole attribution chain's first link — the id it returns is
 * what the backend later sends to the Measurement Protocol so Google Ads can
 * credit a keyword for a conversion that happens days later on the server. A
 * silently wrong parse produces events that look successfully sent and attribute
 * to nothing, so the shapes below are pinned deliberately.
 *
 * Verifies:
 *   - the client id is the TRAILING `<random>.<timestamp>` pair, not the whole
 *     cookie value (the `GA1.1.` prefix varies with property version and the
 *     domain depth the cookie was set at, and must be discarded)
 *   - it is found whether `_ga` is first, middle, or last among other cookies
 *   - `_ga_XXXX` session cookies, which sit beside `_ga` and start with the same
 *     characters, are NOT mistaken for it
 *   - absence returns null rather than throwing or an empty string
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getGaClientId } from '../analytics';

/** Replace document.cookie wholesale — jsdom appends on assignment. */
function setCookies(value: string) {
    Object.defineProperty(document, 'cookie', {
        value,
        writable: true,
        configurable: true,
    });
}

afterEach(() => setCookies(''));

describe('getGaClientId', () => {
    it('returns only the trailing client id, not the versioned prefix', () => {
        setCookies('_ga=GA1.1.1234567890.1678901234');
        expect(getGaClientId()).toBe('1234567890.1678901234');
    });

    it('handles the other domain-depth prefixes GA emits', () => {
        setCookies('_ga=GA1.2.987654321.1600000000');
        expect(getGaClientId()).toBe('987654321.1600000000');
        setCookies('_ga=GA1.3.111.222');
        expect(getGaClientId()).toBe('111.222');
    });

    it('finds _ga among other cookies regardless of position', () => {
        setCookies('csrfToken=abc; _ga=GA1.1.555.666; theme=dark');
        expect(getGaClientId()).toBe('555.666');

        setCookies('_ga=GA1.1.777.888; csrfToken=abc');
        expect(getGaClientId()).toBe('777.888');

        setCookies('theme=dark; _ga=GA1.1.999.111');
        expect(getGaClientId()).toBe('999.111');
    });

    it('does not mistake a _ga_XXXX session cookie for the client id', () => {
        // GA4 sets both; only `_ga` carries the client id. `_ga_ABC` has a
        // different value shape entirely (GS1.1.<session>.<n>.<...>).
        setCookies('_ga_ABC123=GS1.1.1700000000.1.1.1700000001.0.0.0');
        expect(getGaClientId()).toBeNull();

        // …and with both present, the real one still wins.
        setCookies('_ga_ABC123=GS1.1.1700000000.1.1.1700000001.0.0.0; _ga=GA1.1.333.444');
        expect(getGaClientId()).toBe('333.444');
    });

    it('returns null when no _ga cookie exists', () => {
        setCookies('');
        expect(getGaClientId()).toBeNull();

        setCookies('csrfToken=abc; theme=dark');
        expect(getGaClientId()).toBeNull();
    });
});
