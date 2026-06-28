import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostReplyIntroBanner } from './PostReplyIntroBanner';

describe('PostReplyIntroBanner', () => {
  beforeEach(() => localStorage.clear());

  it('renders the intro text and an accessible CTA', () => {
    render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    expect(screen.getByText('Auto-reply to commenters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set one up' })).toBeInTheDocument();
  });

  it('calls onSetup when the CTA is clicked', () => {
    const onSetup = vi.fn();
    render(<PostReplyIntroBanner onSetup={onSetup} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set one up' }));
    expect(onSetup).toHaveBeenCalledTimes(1);
  });

  it('keeps the intro copy channel-neutral — must not promise a delivery channel', () => {
    // The reply channel (public comment vs DM) is governed by the merchant's
    // commentReplyMode setting (default 'public'), so the copy must NOT claim "DM".
    // Regression guard: this wording was wrong twice before.
    render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    expect(screen.getByRole('status').textContent || '').not.toMatch(/\bDM\b/i);
  });

  it('hides itself and persists dismissal across remounts', () => {
    const { unmount } = render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Auto-reply to commenters')).not.toBeInTheDocument();

    // Fresh mount reads the persisted dismissal from localStorage.
    unmount();
    render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    expect(screen.queryByText('Auto-reply to commenters')).not.toBeInTheDocument();
  });
});
