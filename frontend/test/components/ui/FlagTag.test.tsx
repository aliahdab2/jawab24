import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlagTag } from '../../../src/components/ui/FlagTag';
import { flagReasonEn as enFlagReason } from '@jawab24/shared';

describe('FlagTag', () => {
  it('renders nothing when flagReason is null', () => {
    const { container } = render(<FlagTag flagReason={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when flagReason is undefined', () => {
    const { container } = render(<FlagTag flagReason={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when flagReason is empty string', () => {
    const { container } = render(<FlagTag flagReason="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders translated label for cancellation_request', () => {
    render(<FlagTag flagReason="cancellation_request" />);
    expect(screen.getByText(enFlagReason.cancellation_request)).toBeInTheDocument();
  });

  it('renders translated label for refund_request', () => {
    render(<FlagTag flagReason="refund_request" />);
    expect(screen.getByText(enFlagReason.refund_request)).toBeInTheDocument();
  });

  it('renders translated label for exchange_request', () => {
    render(<FlagTag flagReason="exchange_request" />);
    expect(screen.getByText(enFlagReason.exchange_request)).toBeInTheDocument();
  });

  it('renders translated label for low_confidence', () => {
    render(<FlagTag flagReason="low_confidence" />);
    expect(screen.getByText(enFlagReason.low_confidence)).toBeInTheDocument();
  });

  it('picks urgent flag from comma-separated list', () => {
    render(<FlagTag flagReason="low_confidence,cancellation_request" />);
    // Should show the urgent flag, not the non-urgent one
    expect(screen.getByText(enFlagReason.cancellation_request)).toBeInTheDocument();
  });

  it('applies status-error class for urgent flags', () => {
    const { container } = render(<FlagTag flagReason="cancellation_request" />);
    const tag = container.firstChild as HTMLElement;
    expect(tag.className).toContain('status-error');
  });

  it('applies status-warning class for non-urgent flags', () => {
    const { container } = render(<FlagTag flagReason="low_confidence" />);
    const tag = container.firstChild as HTMLElement;
    expect(tag.className).toContain('status-warning');
  });

  it('applies pulse animation for urgent flags', () => {
    const { container } = render(<FlagTag flagReason="angry_customer" />);
    const tag = container.firstChild as HTMLElement;
    expect(tag.className).toContain('animate-pulse-soft');
  });

  it('does not apply pulse animation for non-urgent flags', () => {
    const { container } = render(<FlagTag flagReason="info_not_in_kb" />);
    const tag = container.firstChild as HTMLElement;
    expect(tag.className).not.toContain('animate-pulse-soft');
  });

  it('renders translated SLA flag with minutes', () => {
    render(<FlagTag flagReason="sla_no_reply:60" />);
    // slaNoReply template: "No reply after {minutes} min"
    expect(screen.getByText('No reply after 60 min')).toBeInTheDocument();
  });

  it('renders translated negative_sentiment flag', () => {
    render(<FlagTag flagReason="negative_sentiment" />);
    expect(screen.getByText(enFlagReason.negative_sentiment)).toBeInTheDocument();
  });

  it('renders translated human_requested flag', () => {
    render(<FlagTag flagReason="human_requested" />);
    expect(screen.getByText(enFlagReason.human_requested)).toBeInTheDocument();
  });

  it('accepts custom className', () => {
    const { container } = render(<FlagTag flagReason="low_confidence" className="mt-2" />);
    const tag = container.firstChild as HTMLElement;
    expect(tag.className).toContain('mt-2');
  });
});
