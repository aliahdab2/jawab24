import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SmartStatusBanner, type NeedsAttentionItem } from './SmartStatusBanner';

function makeItem(overrides: Partial<NeedsAttentionItem> = {}): NeedsAttentionItem {
  return {
    id: '1',
    type: 'message',
    senderName: 'Ali',
    text: 'What are your packages?',
    createdAt: '2026-03-01T10:00:00Z',
    flagReason: null,
    href: '/messages?filter=needs_action',
    senderId: 'sender1',
    pageId: 'page1',
    ...overrides,
  };
}

function renderBanner(items: NeedsAttentionItem[], onClick = vi.fn()) {
  return render(
    <SmartStatusBanner
      commentNeedsAction={0}
      messageNeedsAction={items.length}
      items={items}
      onMessageItemClick={onClick}
    />,
  );
}

describe('SmartStatusBanner', () => {
  it('renders the correct attention count in the header button aria-label', () => {
    renderBanner([makeItem(), makeItem({ id: '2' })]);
    expect(screen.getByRole('button', { name: /2 items need your attention/i })).toBeInTheDocument();
  });

  it('renders items in the DOM after expanding', () => {
    renderBanner([makeItem()]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.getByText('What are your packages?')).toBeInTheDocument();
  });

  // Regression: bug where comma-separated flagReason was passed directly to
  // the translator, rendering raw "flagReason.info_not_in_kb,low_confidence"
  it('shows translated primary flag label for comma-separated flagReason', () => {
    renderBanner([makeItem({ flagReason: 'info_not_in_kb,low_confidence' })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.getByText('Information not in knowledge base')).toBeInTheDocument();
    expect(screen.queryByText(/info_not_in_kb,low_confidence/)).not.toBeInTheDocument();
    expect(screen.queryByText(/flagReason\./)).not.toBeInTheDocument();
  });

  it('shows translated label for single flag', () => {
    renderBanner([makeItem({ flagReason: 'angry_customer' })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.getByText('Angry customer')).toBeInTheDocument();
  });

  it('does not show a flag tag for sla_no_reply (default reason)', () => {
    renderBanner([makeItem({ flagReason: 'sla_no_reply:60' })]);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    expect(screen.queryByText(/sla_no_reply/)).not.toBeInTheDocument();
  });

  it('calls onMessageItemClick when a message item is clicked', () => {
    const onClick = vi.fn();
    renderBanner([makeItem()], onClick);
    fireEvent.click(screen.getByRole('button', { name: /item.*need.*attention/i }));
    fireEvent.click(screen.getByText('What are your packages?'));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });
});
