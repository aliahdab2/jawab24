/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useIsEmbedded } from './useIsEmbedded';

const mockQuery: Record<string, string | string[] | undefined> = {};
vi.mock('next/router', () => ({
  useRouter: () => ({ query: mockQuery }),
}));

function Probe() {
  const isEmbedded = useIsEmbedded();
  return <span data-testid="result">{isEmbedded ? 'yes' : 'no'}</span>;
}

describe('useIsEmbedded', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockQuery)) delete mockQuery[k];
    window.sessionStorage.clear();
  });

  it('returns false by default', () => {
    render(<Probe />);
    expect(screen.getByTestId('result').textContent).toBe('no');
  });

  it('returns true when ?embedded=1 is present', () => {
    mockQuery.embedded = '1';
    render(<Probe />);
    expect(screen.getByTestId('result').textContent).toBe('yes');
  });

  it('persists the embedded flag across navigations via sessionStorage', () => {
    mockQuery.embedded = '1';
    const first = render(<Probe />);
    expect(first.getByTestId('result').textContent).toBe('yes');
    first.unmount();

    // Simulate a navigation to a URL without the query param.
    delete mockQuery.embedded;
    render(<Probe />);
    expect(screen.getByTestId('result').textContent).toBe('yes');
  });

  it('does not persist flag for non-embedded sessions', () => {
    render(<Probe />);
    expect(window.sessionStorage.getItem('jawab24_embedded')).toBeNull();
  });

  it('survives sessionStorage being unavailable (stubbed setItem throw)', () => {
    mockQuery.embedded = '1';
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<Probe />);
    expect(screen.getByTestId('result').textContent).toBe('yes');
    setItem.mockRestore();
  });
});
