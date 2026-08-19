import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '../test-utils';
import TrustPage from '@/pages/trust';
import { UPTIME_STATS, CHECK_INTERVAL_MINUTES, DOWNTIME_MINUTES } from '@/data/uptime';
import { loadNamespaces } from '@/i18n/getMessages';

const PUBLIC_DIR = resolve(__dirname, '../../public');
const readPublic = (f: string) => readFileSync(resolve(PUBLIC_DIR, f), 'utf-8');

describe('/trust page', () => {
    it('renders the measured uptime figure and its window', () => {
        render(<TrustPage />);
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        expect(screen.getByText(`${UPTIME_STATS.percent}%`)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(UPTIME_STATS.windowStart))).toBeInTheDocument();
        expect(screen.getByText(new RegExp(UPTIME_STATS.windowEnd))).toBeInTheDocument();
    });

    it('cites the third-party status page in a new tab, safely', () => {
        render(<TrustPage />);
        const link = screen.getByRole('link', { name: new RegExp(UPTIME_STATS.provider, 'i') });
        expect(link).toHaveAttribute('href', UPTIME_STATS.statusPageUrl);
        expect(link).toHaveAttribute('target', '_blank');
        // Without noopener the opened page gets a handle on ours.
        expect(link.getAttribute('rel')).toContain('noopener');
    });

    it('links to the data documents a reader needs to verify the claim', () => {
        render(<TrustPage />);
        for (const href of ['/privacy', '/terms', '/data-deletion', '/contact']) {
            expect(
                screen.getAllByRole('link').some((a) => a.getAttribute('href') === href),
            ).toBe(true);
        }
    });

    it('does not skip a heading level', () => {
        render(<TrustPage />);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
        expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0);
    });
});

describe('trust namespace registration', () => {
    // The step that is easy to miss: tests auto-discover the JSON files, but
    // production uses the static NS table. A missing entry ships raw keys and
    // no other check catches it.
    // loadNamespaces resolves against that static table, so an unregistered
    // namespace comes back as {} here exactly as it would render raw keys in
    // production.
    it.each(['en', 'ar'])('resolves real strings for %s, not an empty object', (locale) => {
        const messages = loadNamespaces(locale, ['trust']) as Record<string, Record<string, string>>;
        expect(Object.keys(messages.trust ?? {}).length).toBeGreaterThan(0);
        expect(messages.trust.uptimeHeading).toBeTruthy();
    });
});

describe('uptime figure agrees with what we tell AI assistants', () => {
    // validate-llms.js pins llms.txt against llms-full.txt, but nothing pins
    // either against UPTIME_STATS — refreshing the constant alone would leave
    // the page and the llms files disagreeing, silently.
    const expected = `${UPTIME_STATS.percent}% uptime measured over ${UPTIME_STATS.windowDays} days`;

    it.each(['llms.txt', 'llms-full.txt'])('%s states the same figure as UPTIME_STATS', (file) => {
        expect(readPublic(file)).toContain(expected);
    });

    it.each(['llms.txt', 'llms-full.txt'])('%s cites the same status page URL', (file) => {
        expect(readPublic(file)).toContain(UPTIME_STATS.statusPageUrl);
    });

    it('states the measurement window that the constant declares', () => {
        const window = `(${UPTIME_STATS.windowStart} to ${UPTIME_STATS.windowEnd})`;
        expect(readPublic('llms.txt')).toContain(window);
        expect(readPublic('llms-full.txt')).toContain(window);
    });

    it('derives the check interval from the recorded seconds', () => {
        expect(CHECK_INTERVAL_MINUTES).toBe(UPTIME_STATS.checkIntervalSeconds / 60);
    });
});

describe('the published percentage is arithmetically honest', () => {
    // The consistency tests above would happily agree on a WRONG number. This
    // one recomputes it from the recorded downtime, so a typo or a mis-read
    // stats call fails here instead of going live as a trust claim.
    const windowSeconds = UPTIME_STATS.windowDays * 24 * 60 * 60;
    const actual = (1 - UPTIME_STATS.downtimeSeconds / windowSeconds) * 100;

    it('matches downtimeSeconds over the window', () => {
        expect(actual).toBeCloseTo(99.979, 3);
    });

    it('is rounded DOWN, never up — we may under-claim, never over-claim', () => {
        const published = Number(UPTIME_STATS.percent);
        expect(published).toBeLessThanOrEqual(actual);
        // ...but not so far down that we throw the achievement away.
        expect(published).toBeGreaterThan(actual - 0.01);
    });

    it('publishes the worst monitor, so no reader can compute a lower one', () => {
        // All recorded downtime sits on one monitor; the other had none. The
        // published figure must therefore equal that worst monitor's uptime,
        // NOT the account-wide average UptimeRobot reports (99.99%).
        expect(Number(UPTIME_STATS.percent)).toBeLessThan(99.99);
    });

    it('states downtime in minutes consistent with the seconds', () => {
        expect(DOWNTIME_MINUTES).toBe(27);
    });
});

describe('the published claim has not gone stale', () => {
    // A measured figure with no expiry is a claim that will eventually be false
    // while every other gate stays green. Nothing else in the repo knows this
    // number needs re-reading, so the deadline lives here — the same reasoning
    // that puts an `expires` on an @UnboundedFetch escape hatch.
    const MAX_AGE_MONTHS = 6;

    it(`was measured within the last ${MAX_AGE_MONTHS} months`, () => {
        const measured = new Date(`${UPTIME_STATS.measuredAt}T00:00:00Z`);
        expect(Number.isNaN(measured.getTime())).toBe(false);

        const deadline = new Date(measured);
        deadline.setUTCMonth(deadline.getUTCMonth() + MAX_AGE_MONTHS);

        const stale = Date.now() > deadline.getTime();
        expect(
            stale,
            `The uptime figure on /trust was measured ${UPTIME_STATS.measuredAt} and is now more ` +
            `than ${MAX_AGE_MONTHS} months old — it is published as fact on a public page.\n` +
            `Re-read the ${UPTIME_STATS.windowDays}-day stats AND the incident list in ` +
            `${UPTIME_STATS.provider}, recompute from the WORST monitor, then update ` +
            `src/data/uptime.ts (percent, window dates, incidents, downtimeSeconds, measuredAt) ` +
            `and mirror the sentence into public/llms.txt and public/llms-full.txt.`,
        ).toBe(false);
    });

    it('does not claim a window that ends in the future', () => {
        // Compare CALENDAR DATES, not instants: a window ending today is valid,
        // but its end-of-day UTC timestamp is still ahead of now for most of
        // the day. Both sides are UTC ISO dates, so string order is date order.
        const today = new Date().toISOString().slice(0, 10);
        expect(UPTIME_STATS.windowEnd <= today).toBe(true);
        expect(UPTIME_STATS.windowStart < UPTIME_STATS.windowEnd).toBe(true);
    });
});
