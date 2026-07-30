import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChoiceRow } from './ChoiceRow';

describe('ChoiceRow', () => {
    const props = {
        accent: 'emerald' as const,
        icon: <svg data-testid="icon" />,
        title: 'Keep my number',
        description: 'It stays on your phone',
        onClick: vi.fn(),
    };

    it('renders title and description and fires onClick', () => {
        const onClick = vi.fn();
        render(<ChoiceRow {...props} onClick={onClick} />);

        expect(screen.getByText('Keep my number')).toBeInTheDocument();
        expect(screen.getByText('It stays on your phone')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not fire onClick while disabled', () => {
        const onClick = vi.fn();
        render(<ChoiceRow {...props} onClick={onClick} disabled />);

        fireEvent.click(screen.getByRole('button'));
        expect(onClick).not.toHaveBeenCalled();
    });

    it('renders the badge only when one is given', () => {
        const { rerender } = render(<ChoiceRow {...props} />);
        expect(screen.queryByText('Recommended')).not.toBeInTheDocument();

        rerender(<ChoiceRow {...props} badge={<span>Recommended</span>} />);
        expect(screen.getByText('Recommended')).toBeInTheDocument();
        // The title must survive the badge branch — it renders in a different
        // wrapper depending on whether a badge is present.
        expect(screen.getByText('Keep my number')).toBeInTheDocument();
    });

    it('keeps the decorative icon out of the accessibility tree', () => {
        render(<ChoiceRow {...props} />);
        expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
    });

    // The brand scale is CSS-variable-based and already inverts in dark mode;
    // a dark: hover override would double-flip it. The raw Tailwind palettes
    // used by the other accents do need theirs.
    it('gives brand no dark: hover override, and the raw palettes one', () => {
        const { rerender } = render(<ChoiceRow {...props} accent="brand" />);
        expect(screen.getByRole('button').className).not.toMatch(/dark:hover:/);

        rerender(<ChoiceRow {...props} accent="blue" />);
        expect(screen.getByRole('button').className).toMatch(/dark:hover:/);
    });
});
