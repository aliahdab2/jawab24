import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useClampOverflow } from '../useClampOverflow';

/**
 * jsdom has no layout engine (scrollHeight/clientHeight are always 0) and the
 * test setup mocks ResizeObserver as a no-op, so the hook's initial synchronous
 * measure is what we exercise here by mocking the two height getters.
 */
function Probe({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const { ref, isOverflowing } = useClampOverflow<HTMLParagraphElement>(content, expanded);
  return (
    <div>
      <p ref={ref}>{content}</p>
      <span data-testid="overflowing">{String(isOverflowing)}</span>
      {(isOverflowing || expanded) && (
        <button onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

const origScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const origClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

function mockHeights(scrollHeight: number, clientHeight: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight });
}

describe('useClampOverflow', () => {
  beforeEach(() => mockHeights(0, 0));
  afterEach(() => {
    if (origScroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', origScroll);
    if (origClient) Object.defineProperty(HTMLElement.prototype, 'clientHeight', origClient);
  });

  it('reports overflow (and shows the toggle) when the clamped content is truncated', () => {
    mockHeights(240, 60);
    render(<Probe content="a long post" />);
    expect(screen.getByTestId('overflowing').textContent).toBe('true');
    expect(screen.getByRole('button', { name: 'more' })).toBeInTheDocument();
  });

  it('reports no overflow (and hides the toggle) when the content fits', () => {
    mockHeights(60, 60);
    render(<Probe content="short" />);
    expect(screen.getByTestId('overflowing').textContent).toBe('false');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the toggle visible after expanding (measuring is skipped while expanded)', () => {
    mockHeights(240, 60);
    render(<Probe content="a long post" />);
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    // Now expanded — the toggle must remain so the user can collapse again.
    expect(screen.getByRole('button', { name: 'less' })).toBeInTheDocument();
  });
});
