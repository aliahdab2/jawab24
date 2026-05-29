import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NeedsAttentionBanner } from './NeedsAttentionBanner';

describe('NeedsAttentionBanner', () => {
  it('renders no KB CTA for non-KB flags', () => {
    render(<NeedsAttentionBanner flagReason="angry_customer" onAddToKb={() => {}} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders an in-place "Add to Business Info" button for KB flags and calls onAddToKb when clicked', () => {
    // The CTA now opens the Business Info editor in place over the conversation
    // (InlineKbEditorModal) instead of navigating to /pages — so it is a button
    // that invokes the supplied handler, not a deep-link.
    const onAddToKb = vi.fn();
    render(<NeedsAttentionBanner flagReason="info_not_in_kb" onAddToKb={onAddToKb} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(onAddToKb).toHaveBeenCalledTimes(1);
  });

  it('renders the CTA button for price_not_in_kb', () => {
    render(<NeedsAttentionBanner flagReason="price_not_in_kb" onAddToKb={() => {}} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('hides the KB CTA when no onAddToKb handler is provided (no page context)', () => {
    render(<NeedsAttentionBanner flagReason="info_not_in_kb" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
