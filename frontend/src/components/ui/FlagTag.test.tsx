import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FlagTag } from './FlagTag';

describe('FlagTag', () => {
  it('renders nothing when flagReason is null', () => {
    const { container } = render(<FlagTag flagReason={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when flagReason is empty string', () => {
    const { container } = render(<FlagTag flagReason="" />);
    expect(container.firstChild).toBeNull();
  });

  it('translates a single flag key', () => {
    render(<FlagTag flagReason="low_confidence" />);
    expect(screen.getByText('Low confidence reply')).toBeInTheDocument();
  });

  it('translates a single info_not_in_kb flag', () => {
    render(<FlagTag flagReason="info_not_in_kb" />);
    expect(screen.getByText('Information not in knowledge base')).toBeInTheDocument();
  });

  // Regression: bug where FlagTag received "info_not_in_kb,low_confidence" and
  // rendered the raw combined string instead of the primary flag translation
  it('shows translated primary flag when flagReason contains comma-separated keys', () => {
    render(<FlagTag flagReason="info_not_in_kb,low_confidence" />);
    expect(screen.getByText('Information not in knowledge base')).toBeInTheDocument();
    // Must NOT show the raw combined string
    expect(screen.queryByText('info_not_in_kb,low_confidence')).not.toBeInTheDocument();
    expect(screen.queryByText(/flagReason\./)).not.toBeInTheDocument();
  });

  it('prioritizes urgent flag over non-urgent when both present', () => {
    render(<FlagTag flagReason="info_not_in_kb,angry_customer" />);
    expect(screen.getByText('Angry customer')).toBeInTheDocument();
    expect(screen.queryByText('Information not in knowledge base')).not.toBeInTheDocument();
  });

  it('translates angry_customer flag', () => {
    render(<FlagTag flagReason="angry_customer" />);
    expect(screen.getByText('Angry customer')).toBeInTheDocument();
  });
});
