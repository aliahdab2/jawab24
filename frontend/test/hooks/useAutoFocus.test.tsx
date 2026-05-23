import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useAutoFocus } from '@/hooks/useAutoFocus';

function TestInput({ skip = false }: { skip?: boolean }) {
    const ref = useAutoFocus<HTMLInputElement>(skip);
    return <input ref={ref} aria-label="test" />;
}

describe('useAutoFocus', () => {
    it('focuses the element on mount when skip is false (default)', () => {
        render(<TestInput />);
        const input = document.querySelector('input');
        expect(document.activeElement).toBe(input);
    });

    it('does NOT focus when skip=true (edit-mode case)', () => {
        render(<TestInput skip />);
        const input = document.querySelector('input');
        expect(document.activeElement).not.toBe(input);
    });
});
