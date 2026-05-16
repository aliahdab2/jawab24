import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { NeedsAttentionBanner } from './NeedsAttentionBanner';

describe('NeedsAttentionBanner', () => {
  it('renders no KB link for non-KB flags', () => {
    render(<NeedsAttentionBanner flagReason="angry_customer" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the KB deep-link with the exact href used by /pages auto-open', () => {
    // Regression: the link previously had an onClick that closed the parent
    // modal by firing router.back()/replace(). That raced with Next.js Link's
    // own router.push and swallowed the navigation, so the link did nothing.
    // The static href is the only contract the /pages auto-open useEffect
    // reads — keep it exact.
    render(<NeedsAttentionBanner flagReason="info_not_in_kb" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/pages?openKb=true');
  });

  it('renders the KB link for price_not_in_kb', () => {
    render(<NeedsAttentionBanner flagReason="price_not_in_kb" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pages?openKb=true');
  });
});
