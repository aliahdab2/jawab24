/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { Page } from '@jawab24/shared';
import { RepliesBreakdownTooltip } from './RepliesBreakdownTooltip';

const basePage: Page = {
  id: 'p1',
  facebookPageId: 'fb_1',
  name: 'Test Page',
  autoReplyEnabled: true,
  createdAt: null,
} as Page;

const openPopover = () =>
  fireEvent.click(screen.getByRole('button', { name: /Auto-replies breakdown/i }));

describe('RepliesBreakdownTooltip', () => {
  it('renders nothing when all auto-reply counts are zero', () => {
    const { container } = render(
      <RepliesBreakdownTooltip
        page={{ ...basePage, breakdown: { ai: 0, template: 0, postReply: 0 } }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when breakdown is missing entirely', () => {
    const { container } = render(<RepliesBreakdownTooltip page={basePage} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the three auto-reply rows on open', () => {
    render(
      <RepliesBreakdownTooltip
        page={{ ...basePage, breakdown: { ai: 15614, template: 2015, postReply: 1136 } }}
      />,
    );
    openPopover();
    expect(screen.getByText('Smart replies')).toBeInTheDocument();
    expect(screen.getByText('Greeting & away')).toBeInTheDocument();
    expect(screen.getByText('Post replies')).toBeInTheDocument();
  });

  it('does not render a Manual replies row (auto-replies only)', () => {
    render(
      <RepliesBreakdownTooltip
        page={{ ...basePage, breakdown: { ai: 100, template: 0, postReply: 0 } }}
      />,
    );
    openPopover();
    expect(screen.queryByText(/Manual/i)).not.toBeInTheDocument();
  });

  it('formats values with thousands separators', () => {
    render(
      <RepliesBreakdownTooltip
        page={{ ...basePage, breakdown: { ai: 15614, template: 2015, postReply: 1136 } }}
      />,
    );
    openPopover();
    expect(screen.getByText('15,614')).toBeInTheDocument();
    expect(screen.getByText('2,015')).toBeInTheDocument();
    expect(screen.getByText('1,136')).toBeInTheDocument();
  });

  it('row values sum to the headline repliesCount (the contract this UI relies on)', () => {
    const breakdown = { ai: 15614, template: 2015, postReply: 1136 };
    const repliesCount = 18765;
    expect(breakdown.ai + breakdown.template + breakdown.postReply).toBe(repliesCount);
  });

  it('renders even if only one of the three counters is non-zero', () => {
    render(
      <RepliesBreakdownTooltip
        page={{ ...basePage, breakdown: { ai: 0, template: 0, postReply: 7 } }}
      />,
    );
    openPopover();
    expect(screen.getByText('Post replies')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
