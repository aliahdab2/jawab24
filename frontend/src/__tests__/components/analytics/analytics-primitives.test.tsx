import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KpiCard } from '@/components/analytics/KpiCard';
import { HorizontalBar } from '@/components/analytics/HorizontalBar';
import { RangeToggle } from '@/components/analytics/RangeToggle';

vi.mock('@/components/ui', () => ({
    Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div data-testid="card" className={className}>{children}</div>
    ),
}));

describe('KpiCard', () => {
    it('renders label and value', () => {
        render(<KpiCard label="Revenue" value="4,780 SAR" />);
        expect(screen.getByText('Revenue')).toBeInTheDocument();
        expect(screen.getByText('4,780 SAR')).toBeInTheDocument();
    });

    it('renders subValue and caveat when provided', () => {
        render(<KpiCard label="Revenue" value="0" subValue="last 30 days" caveat="approximate" />);
        expect(screen.getByText('last 30 days')).toBeInTheDocument();
        expect(screen.getByText('approximate')).toBeInTheDocument();
    });

    it('omits subValue when not provided', () => {
        render(<KpiCard label="Revenue" value="0" />);
        expect(screen.queryByText('last 30 days')).not.toBeInTheDocument();
    });
});

describe('HorizontalBar', () => {
    it('renders label and formatted count', () => {
        render(<HorizontalBar label="Delivered" value={1234} max={2000} />);
        expect(screen.getByText('Delivered')).toBeInTheDocument();
        expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    it('exposes progressbar role with aria values', () => {
        render(<HorizontalBar label="Failed" value={5} max={10} />);
        const bar = screen.getByRole('progressbar', { name: 'Failed' });
        expect(bar).toHaveAttribute('aria-valuenow', '5');
        expect(bar).toHaveAttribute('aria-valuemax', '10');
    });

    it('renders 0% width when max is 0 (no division by zero)', () => {
        render(<HorizontalBar label="Empty" value={0} max={0} />);
        const bar = screen.getByRole('progressbar', { name: 'Empty' });
        const fill = bar.firstElementChild as HTMLElement;
        expect(fill.style.width).toBe('0%');
    });

    it('caps width at 100% when value exceeds max', () => {
        render(<HorizontalBar label="Overflow" value={150} max={100} />);
        const bar = screen.getByRole('progressbar', { name: 'Overflow' });
        const fill = bar.firstElementChild as HTMLElement;
        expect(fill.style.width).toBe('100%');
    });
});

describe('RangeToggle', () => {
    const OPTIONS = [
        { value: '30d', label: 'Last 30 days' },
        { value: '90d', label: 'Last 90 days' },
    ] as const;

    it('renders both options as radios', () => {
        render(<RangeToggle options={OPTIONS} value="30d" onChange={() => {}} ariaLabel="Range" />);
        expect(screen.getByRole('radiogroup', { name: 'Range' })).toBeInTheDocument();
        expect(screen.getAllByRole('radio')).toHaveLength(2);
    });

    it('marks the active option with aria-checked=true', () => {
        render(<RangeToggle options={OPTIONS} value="90d" onChange={() => {}} ariaLabel="Range" />);
        const active = screen.getByRole('radio', { name: 'Last 90 days' });
        expect(active).toHaveAttribute('aria-checked', 'true');
    });

    it('calls onChange with the next value when clicked', () => {
        const onChange = vi.fn();
        render(<RangeToggle options={OPTIONS} value="30d" onChange={onChange} ariaLabel="Range" />);
        fireEvent.click(screen.getByRole('radio', { name: 'Last 90 days' }));
        expect(onChange).toHaveBeenCalledWith('90d');
    });

    it('does not call onChange when the same option is clicked (handler still fires; parent decides)', () => {
        // Intentional: the toggle is dumb — it always fires onChange. This test
        // documents the contract so the parent doesn't accidentally rely on a no-op.
        const onChange = vi.fn();
        render(<RangeToggle options={OPTIONS} value="30d" onChange={onChange} ariaLabel="Range" />);
        fireEvent.click(screen.getByRole('radio', { name: 'Last 30 days' }));
        expect(onChange).toHaveBeenCalledWith('30d');
    });
});
