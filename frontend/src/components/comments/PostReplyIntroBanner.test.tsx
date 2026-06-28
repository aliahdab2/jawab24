import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostReplyIntroBanner } from './PostReplyIntroBanner';

const KEY = 'postReplyIntro';
const TITLE = 'Auto-reply to commenters';
const FAR_FUTURE = 9_999_999_999_999; // ~year 2286
const PAST = 1; // epoch+1ms

describe('PostReplyIntroBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('renders the intro text and an accessible CTA', () => {
    render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set one up' })).toBeInTheDocument();
  });

  it('calls onSetup when the CTA is clicked', () => {
    const onSetup = vi.fn();
    render(<PostReplyIntroBanner onSetup={onSetup} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set one up' }));
    expect(onSetup).toHaveBeenCalledTimes(1);
  });

  it('keeps the intro copy channel-neutral — must not promise a delivery channel', () => {
    // The reply channel (public comment vs DM) is governed by commentReplyMode
    // (default 'public'), so the copy must NOT claim "DM". Regression guard.
    render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    expect(screen.getByRole('status').textContent || '').not.toMatch(/\bDM\b/i);
  });

  it('still shows while under the 3-view cap', () => {
    localStorage.setItem(KEY, JSON.stringify({ count: 2, postponedUntil: null }));
    render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });

  it('postpones (hides) after 3 views until the cooldown elapses', () => {
    localStorage.setItem(KEY, JSON.stringify({ count: 3, postponedUntil: FAR_FUTURE }));
    render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('re-appears for another round once the ~6-month postpone has elapsed', () => {
    localStorage.setItem(KEY, JSON.stringify({ count: 3, postponedUntil: PAST }));
    render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });

  it('hides on manual dismiss and stays hidden across remounts (postponed)', () => {
    const { unmount } = render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();

    unmount();
    render(<PostReplyIntroBanner onSetup={vi.fn()} />);
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });
});
