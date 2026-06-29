import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AiCreditRunwayBanner } from './AiCreditRunwayBanner';
import type { AdminAiRunway } from '@/lib/api';

function runway(overrides: Partial<AdminAiRunway> = {}): AdminAiRunway {
    return {
        configured: true,
        balanceUsd: 100,
        anchoredAt: '2026-06-01',
        orgSpentSinceAnchorUsd: 50,
        remainingUsd: 50,
        rollingDailyRateUsd: 5,
        runwayDays: 10,
        severity: 'warning',
        currentlyParking: false,
        ...overrides,
    };
}

describe('AiCreditRunwayBanner', () => {
    it('renders nothing when severity is ok', () => {
        const { container } = render(<AiCreditRunwayBanner runway={runway({ severity: 'ok' })} />);
        expect(container.firstChild).toBeNull();
    });

    it('shows the parking message (no remaining/rate) when currently parking', () => {
        render(<AiCreditRunwayBanner runway={runway({
            severity: 'critical', currentlyParking: true, configured: false,
            balanceUsd: null, remainingUsd: null, runwayDays: null, rollingDailyRateUsd: 0,
        })} />);
        expect(screen.getByText(/parked until OpenAI credit/i)).toBeInTheDocument();
        // Must NOT print a bogus rate clause.
        expect(screen.queryByText(/\/day/)).not.toBeInTheDocument();
    });

    it('omits the days/rate clause when there is no burn rate yet (runwayDays null)', () => {
        render(<AiCreditRunwayBanner runway={runway({
            severity: 'warning', remainingUsd: 19.63, rollingDailyRateUsd: 0, runwayDays: null,
        })} />);
        // remaining is shown...
        expect(screen.getByText(/\$19\.63 left/)).toBeInTheDocument();
        // ...but the "about — days at $0.00/day" clause is suppressed.
        expect(screen.queryByText(/\/day/)).not.toBeInTheDocument();
        expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
    });

    it('shows full detail (remaining + days + rate) when a burn rate exists', () => {
        render(<AiCreditRunwayBanner runway={runway({
            severity: 'critical', remainingUsd: 14.4, rollingDailyRateUsd: 5.09, runwayDays: 2.8,
        })} />);
        expect(screen.getByText(/\$14\.40 left/)).toBeInTheDocument();
        expect(screen.getByText(/2\.8 days/)).toBeInTheDocument();
        expect(screen.getByText(/\$5\.09\/day/)).toBeInTheDocument();
    });
});
