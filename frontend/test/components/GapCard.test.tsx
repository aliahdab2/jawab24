import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GapCard } from '@/components/knowledge-base/GapCard';
import kbEn from '@/i18n/en/kb.json';

// Translation mocked globally via test/setup.ts (next-intl mock returns real English strings).
// The approve label is read from the locale file, not retyped here: a copy change
// («Add to KB» → «Add to Business Info», 2026-08-30) turned three of these red in the
// deploy gate while the component was correct.
const ADD_LABEL = kbEn.gaps.addToKb;

const mockGap = {
  id: 'gap-1',
  queryText: 'do you have a warranty?',
  occurrenceCount: 3,
};

describe('GapCard', () => {
  it('renders question text and occurrence count in collapsed state', () => {
    render(
      <GapCard
        gap={mockGap}
        isExpanded={false}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByText('do you have a warranty?')).toBeInTheDocument();
    expect(screen.getByText('3x')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Type your answer...')).not.toBeInTheDocument();
  });

  it('shows textarea and buttons when expanded', () => {
    render(
      <GapCard
        gap={mockGap}
        isExpanded={true}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText('Type your answer...')).toBeInTheDocument();
    expect(screen.getByText(ADD_LABEL)).toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });

  it('disables Add to KB when textarea is empty', () => {
    render(
      <GapCard
        gap={mockGap}
        isExpanded={true}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    const addButton = screen.getByText(ADD_LABEL).closest('button');
    expect(addButton).toBeDisabled();
  });

  it('calls onApprove with textarea value when Add to KB is clicked', () => {
    const onApprove = vi.fn();
    render(
      <GapCard
        gap={mockGap}
        isExpanded={true}
        onToggle={vi.fn()}
        onApprove={onApprove}
        onSkip={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), {
      target: { value: 'We offer 1-year warranty on all products.' },
    });

    fireEvent.click(screen.getByText(ADD_LABEL));
    expect(onApprove).toHaveBeenCalledWith('We offer 1-year warranty on all products.');
  });

  it('calls onSkip when Skip is clicked', () => {
    const onSkip = vi.fn();
    render(
      <GapCard
        gap={mockGap}
        isExpanded={true}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={onSkip}
      />
    );

    fireEvent.click(screen.getByText('Skip'));
    expect(onSkip).toHaveBeenCalled();
  });

  it('shows post context for comment-sourced gaps', () => {
    const gapWithPost = {
      ...mockGap,
      sourceType: 'comment' as const,
      sourceContext: 'Summer collection just arrived!',
    };

    render(
      <GapCard
        gap={gapWithPost}
        isExpanded={false}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByText(/Post.*Summer collection/)).toBeInTheDocument();
  });

  it('shows previous message context for DM-sourced gaps', () => {
    const gapWithDm = {
      ...mockGap,
      sourceType: 'dm' as const,
      sourceContext: 'Do you have running shoes?',
    };

    render(
      <GapCard
        gap={gapWithDm}
        isExpanded={false}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByText(/Do you have running shoes/)).toBeInTheDocument();
  });

  it('does not show context line when sourceContext is null', () => {
    render(
      <GapCard
        gap={mockGap}
        isExpanded={false}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    // No element with the ↩ arrow character
    const contextLine = screen.queryByText(/↩/);
    expect(contextLine).not.toBeInTheDocument();
  });

  it('calls onToggle when header is clicked', () => {
    const onToggle = vi.fn();
    render(
      <GapCard
        gap={mockGap}
        isExpanded={false}
        onToggle={onToggle}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('do you have a warranty?'));
    expect(onToggle).toHaveBeenCalled();
  });
});
