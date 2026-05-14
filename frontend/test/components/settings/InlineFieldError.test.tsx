import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InlineFieldError } from '../../../src/components/settings/InlineFieldError';

describe('InlineFieldError', () => {
    it('renders the message with role="alert" for screen readers', () => {
        render(<InlineFieldError message="Field too long" />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Field too long');
    });

    it('renders nothing when message is undefined', () => {
        const { container } = render(<InlineFieldError />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when message is the empty string', () => {
        const { container } = render(<InlineFieldError message="" />);
        expect(container).toBeEmptyDOMElement();
    });
});
