import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '../test-utils';
import TrustPage from '@/pages/trust';
import { UPTIME_STATS, CHECK_INTERVAL_MINUTES } from '@/data/uptime';
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
